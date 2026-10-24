"""Frame preservation, preflight boundaries and subprocess regressions."""
import contextlib
import copy
import io
import json
from pathlib import Path
import os
import shutil
import subprocess
import sys
import unittest
from unittest.mock import patch
from support import TOOL, READY, REASON, call, ffmpeg, frames, plan, recording, save, temporary
import engine
import install
import plan as plans
import timeline
from paths import TimelineError
from processes import Runner, probe_env, run_kinocut


class BoundaryTests(unittest.TestCase):
    def test_python_render_range_before_work(self):
        for version in ((3, 10), (3, 14)):
            with self.subTest(version=version), temporary() as d:
                out, err = io.StringIO(), io.StringIO()
                with patch.object(sys, 'version_info', version), patch.object(sys, 'version', '%d.%d.0' % version), patch.object(install, 'ensure') as ensure, patch.object(timeline, 'programs') as probes, contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                    code = timeline.main(['render', '--plan', str(Path(d) / 'absent.json'), '--output', str(Path(d) / 'out'), '--install'])
                self.assertEqual((code, out.getvalue()), (1, ''))
                self.assertIn('Python %d.%d.0' % version, err.getvalue())
                self.assertIn(timeline.PYTHON_CHECK, err.getvalue())
                probes.assert_not_called()
                ensure.assert_not_called()
                self.assertEqual(list(Path(d).iterdir()), [])

    def test_check_supported_range(self):
        for version, supported in (((3, 10), False), ((3, 11), True), ((3, 12), True), ((3, 13), True), ((3, 14), False)):
            out = io.StringIO()
            with patch.object(sys, 'version_info', version), patch.object(timeline, 'programs', return_value={'ffmpeg': True, 'ffprobe': True, 'ffmpeg_libx264': True}), patch.object(install, 'state', return_value={'state': 'complete'}), contextlib.redirect_stdout(out):
                self.assertEqual(timeline.main(['check']), 0)
            self.assertEqual(json.loads(out.getvalue())['python']['supported'], supported)

    def test_64_segments_no_install_or_work(self):
        with temporary() as d:
            root = Path(d)
            (root / 'a.mp4').touch()
            value = plan()
            value['segments'] = [dict(value['segments'][0], id='s%d' % i) for i in range(64)]
            path = save(root, value)
            before = sorted(root.iterdir())
            out, err = io.StringIO(), io.StringIO()
            with patch.object(install, 'ensure') as ensure, patch.object(timeline, 'programs') as probes, contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = timeline.main(['render', '--plan', str(path), '--output', str(root / 'out'), '--install'])
            self.assertEqual((code, out.getvalue()), (1, ''))
            self.assertIn('more than 63 segments', err.getvalue())
            self.assertEqual(before, sorted(root.iterdir()))
            ensure.assert_not_called()
            probes.assert_not_called()
            value['segments'].pop()
            self.assertEqual(len(plans.load(save(root, value), TOOL)[0]['segments']), 63)

    def test_all_probes_use_allowlist(self):
        with temporary() as d, patch.dict(os.environ, {'UNLISTED': 'planted', 'FFREPORT': 'file=planted', 'ANTHROPIC_API_KEY': 'synthetic'}):
            runner = Runner()
            with patch('processes.subprocess.run', return_value=subprocess.CompletedProcess([], 0, b'ffmpeg version fixture\n', b'')) as run:
                timeline.programs(runner, Path(d))
            self.assertEqual(run.call_count, 3)
            for invocation in run.call_args_list:
                env = invocation.kwargs['env']
                self.assertEqual(env, probe_env())
                for key in ('UNLISTED', 'FFREPORT', 'ANTHROPIC_API_KEY'):
                    self.assertNotIn(key, env)
            source = Path(d) / 'a.mp4'
            source.touch()
            with patch('processes.subprocess.run', return_value=subprocess.CompletedProcess([], 0, b'{}', b'')) as run:
                plans.probe(source, runner, Path(d), 'ffprobe')
            self.assertEqual(run.call_args.kwargs['env'], probe_env())

    def test_record_path_namespaces(self):
        with temporary() as d:
            root = Path(d).resolve()
            work, output, tool = root / 'work', root / 'cut', root / 'tool'
            values = [str(work / 'clip.mp4'), str(work / 'deliverable/cut.mp4'), str(output / 'cut.otio'), str(tool / 'scripts/encoding.py'), str(root / 'original.mp4')]
            runner = Runner()
            runner.processes.append({'arguments': values, 'cwd': str(work), 'exit_status': 0, 'read': [{'path': v, 'sha256': 'fixture'} for v in values], 'wrote': []})
            row = runner.relative_records(work, output, tool)[0]
            expected = ['clip.mp4', 'output/cut.mp4', 'output/cut.otio', 'tool/scripts/encoding.py', str(root / 'original.mp4')]
            self.assertEqual(row['arguments'], expected)
            self.assertEqual([f['path'] for f in row['read']], expected)
            self.assertEqual(row['cwd'], '.')

    def test_stdlib_profile_is_not_shadowed(self):
        result = subprocess.run([sys.executable, '-B', '-c', 'import sys; sys.path.insert(0,sys.argv[1]); import cProfile, profile; assert not profile.__file__.startswith(sys.argv[1]); import encoding; assert encoding.ENCODE_ARGS', str(TOOL / 'scripts')], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_python39_help_skips_without_real_interpreter(self):
        from test_contract import ContractTests
        with patch('test_contract.shutil.which', return_value=None), patch('test_contract.Path.is_file', return_value=False):
            with self.assertRaisesRegex(unittest.SkipTest, 'no interpreter reporting Python 3.9'):
                ContractTests('test_python39_help').test_python39_help()


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg and ffprobe required')
class PacketTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = temporary()
        cls.root = Path(cls.temp.name)
        recording(cls.root / 'a.mp4', frames=60)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_probe_uses_sorted_packets_without_decode(self):
        target = self.root / 'bframes.mp4'
        ffmpeg(['-i', str(self.root / 'a.mp4'), '-c:v', 'libx264', '-crf', '18', '-bf', '3', '-x264-params', 'b-adapt=0', str(target)])
        runner = Runner()
        data = plans.probe(target, runner, self.root, 'ffprobe')
        args = runner.processes[0]['arguments']
        self.assertIn('-show_packets', args)
        self.assertNotIn('-show_frames', args)
        self.assertNotIn('frames', data)
        pts = [p['pts'] for p in data['packets']]
        self.assertNotEqual(pts, sorted(pts), 'fixture must contain reordered B-frame packets')
        data['packets'].reverse()
        self.assertEqual(plans.media_info(data, 'a', 30)['frames'], 60)

    def test_absent_range_reports_assumption(self):
        data = plans.probe(self.root / 'a.mp4', Runner(), self.root, 'ffprobe')
        data['streams'][0].pop('color_range')
        info = plans.media_info(data, 'a', 30)
        self.assertTrue(info['assumed_bt709'])
        self.assertEqual(info['tags']['color_range'], 'unknown')

    def refused(self, source, name):
        with temporary() as d:
            root = Path(d)
            path = save(root, plan(str(source)))
            before = sorted(root.iterdir())
            out, err = io.StringIO(), io.StringIO()
            with patch.object(install, 'ensure') as ensure, contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = timeline.main(['render', '--plan', str(path), '--output', str(root / 'out'), '--install'])
            self.assertEqual((code, out.getvalue()), (1, ''))
            self.assertIn(name, err.getvalue())
            self.assertEqual(before, sorted(root.iterdir()))
            ensure.assert_not_called()

    def test_yuvj420p_refused(self):
        target = self.root / 'jpeg.mp4'
        ffmpeg(['-i', str(self.root / 'a.mp4'), '-c:v', 'libx264', '-pix_fmt', 'yuvj420p', '-color_range', 'pc', str(target)])
        self.refused(target, 'pixel format yuvj420p')

    def test_full_range_refused(self):
        target = self.root / 'full.mkv'
        ffmpeg(['-i', str(self.root / 'a.mp4'), '-c:v', 'ffv1', '-pix_fmt', 'yuv420p', '-color_range', 'pc', str(target)])
        self.refused(target, 'color_range pc is full range')

    def test_yuv444p_refused(self):
        target = self.root / '444.mkv'
        ffmpeg(['-i', str(self.root / 'a.mp4'), '-c:v', 'ffv1', '-pix_fmt', 'yuv444p', str(target)])
        self.refused(target, 'pixel format yuv444p')

    def test_rotation_refused(self):
        target = self.root / 'rotated.mp4'
        ffmpeg(['-display_rotation:v:0', '90', '-i', str(self.root / 'a.mp4'), '-c:v', 'copy', str(target)])
        self.refused(target, 'rotation/display matrix')

    def test_zero_rotation_accepted_and_unknown_matrix_refused(self):
        data = plans.probe(self.root / 'a.mp4', Runner(), self.root, 'ffprobe')
        data['streams'][0]['side_data_list'] = [{'rotation': 0, 'displaymatrix': 'identity'}]
        self.assertEqual(plans.media_info(data, 'a', 30)['frames'], 60)
        data['streams'][0]['side_data_list'] = [{'displaymatrix': 'unreadable'}]
        with self.assertRaisesRegex(TimelineError, 'rotation/display matrix'):
            plans.media_info(data, 'a', 30)

    def test_frame_size_change_withheld(self):
        # Equal byte counts must not hide different decoded dimensions.
        for name, size in (('wide', '96x64'), ('tall', '64x96')):
            ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=%s:r=30' % size, '-frames:v', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-f', 'h264', str(self.root / (name + '.h264'))])
        source = self.root / 'changing.h264'
        source.write_bytes((self.root / 'wide.h264').read_bytes() + (self.root / 'tall.h264').read_bytes())
        with self.assertRaisesRegex(TimelineError, 'frame size changes'):
            engine.frame_hashes(source, [96, 64], Runner(), self.root, 'ffmpeg')


@unittest.skipUnless(READY, REASON)
class PreservationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(install.site_for(install.cache_for(TOOL))))
        cls.temp = temporary()
        cls.root = Path(cls.temp.name).resolve()
        recording(cls.root / 'base.mp4', frames=60)
        ffmpeg(['-i', str(cls.root / 'base.mp4'), '-c:v', 'copy', '-output_ts_offset', '5', str(cls.root / 'offset.mp4')])

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_offset_speed_one_single_frame_and_whole_file(self):
        value = plan('offset.mp4')
        value['segments'] = [dict(value['segments'][0], id='middle', start=7, end=37), dict(value['segments'][0], id='single', start=41, end=42), dict(value['segments'][0], id='whole', start=0, end=60)]
        path = save(self.root, value)
        data = plans.probe(self.root / 'offset.mp4', Runner(), self.root, 'ffprobe')
        self.assertGreater(min(p['pts'] for p in data['packets']), 0)
        output = self.root / 'offset-cut'
        result = call(['render', '--plan', str(path), '--output', str(output)])
        self.assertEqual(result.returncode, 0, result.stderr)
        original = frames(self.root / 'offset.mp4')
        self.assertEqual(frames(output / 'cut.mp4'), original[7:37] + original[41:42] + original)
        record = json.loads((output / 'record.json').read_text())
        self.assertEqual(record['frame_comparison'], {'frames_compared': 91, 'all_equal': True})
        contents = record['cutfile']['contents']
        self.assertEqual([s['path'] for s in contents['sources']], ['clip-0.mp4', 'clip-1.mp4', 'clip-2.mp4'])
        self.assertEqual([op['start'] for op in contents['ops'][:-1]], [0, 0, 0])
        self.assertEqual([op['op'] for op in contents['ops']], ['trim', 'trim', 'trim', 'merge'])
        decodes = [p for p in record['processes'] if 'framemd5' in p['arguments']]
        self.assertEqual(len(decodes), 2)
        clip_steps = [p for p in record['processes'] if '-vf' in p['arguments'] and 'framemd5' not in p['arguments']]
        self.assertEqual(len(clip_steps), 3)
        for step in clip_steps:
            self.assertIn('trim=start_frame=', step['arguments'][step['arguments'].index('-vf') + 1])

    def test_untagged_source_frames_unchanged(self):
        # A source with no colour tags at all, range included, is taken as BT.709 TV range and cut unconverted.
        source = self.root / 'untagged.mp4'
        expression = "nullsrc=s=96x64:r=30,geq=lum='16+mod(N*31+X*13+Y*7,220)':cb=128:cr=128"
        ffmpeg(['-f', 'lavfi', '-i', expression, '-frames:v', '40', '-an', '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv420p', str(source)])
        data = plans.probe(source, Runner(), self.root, 'ffprobe')
        self.assertNotIn('color_range', data['streams'][0])
        value = plan('untagged.mp4')
        value['segments'] = [dict(value['segments'][0], id='slow', start=2, end=14), dict(value['segments'][0], id='fast', start=14, end=38, speed=2)]
        output = self.root / 'untagged-cut'
        result = call(['render', '--plan', str(save(self.root, value)), '--output', str(output)])
        self.assertEqual(result.returncode, 0, result.stderr)
        original = frames(source)
        self.assertEqual(frames(output / 'cut.mp4'), original[2:14] + original[14:38:2])
        self.assertEqual(json.loads(result.stdout)['assumed_bt709'], ['a'])

    def test_wrong_frame_withholds_output(self):
        path = save(self.root, plan('base.mp4'))
        output = self.root / 'wrong-frame'
        run = Runner.run
        def corrupt(runner, args, *pos, **kwargs):
            if '-vf' in args and str(args[-1]).endswith('clip-0.mp4'):
                args = list(args)
                index = args.index('-vf') + 1
                args[index] += ',drawbox=x=0:y=0:w=8:h=8:color=white:t=fill:enable=eq(n\\,1)'
            return run(runner, args, *pos, **kwargs)
        out, err = io.StringIO(), io.StringIO()
        with patch.object(Runner, 'run', new=corrupt), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = timeline.main(['render', '--plan', str(path), '--output', str(output)])
        self.assertEqual((code, out.getvalue()), (1, ''))
        self.assertIn('segment one, output frame 1, source frame 8', err.getvalue())
        self.assertFalse(output.exists())
        self.assertEqual(list(self.root.glob('.timeline-work-*')), [])

    def test_kinocut_error_class_and_code(self):
        with temporary() as d:
            root = Path(d).resolve()
            cutfile = root / 'bad.json'
            cutfile.write_text(json.dumps({'name': 'bad', 'version': 1, 'sources': [{'id': 'clip', 'path': 'clip.mp4'}], 'ops': [{'id': 'bad', 'op': 'trim', 'src': 'unknown', 'start': 0, 'duration': 1}]}))
            args = [str(install.cache_for(TOOL) / 'bin/python3'), '-B', str(TOOL / 'scripts/kino_bridge.py'), str(cutfile), str(root / 'cut.mp4'), str(root / 'receipt.json')]
            with self.assertRaisesRegex(TimelineError, 'Kinocut MCPVideoError code=cutfile_unknown_ref') as error:
                run_kinocut(args, root, Runner())
            self.assertNotIn(str(root), str(error.exception))

    def test_kinocut_cause_in_render_refusal(self):
        path = save(self.root, plan('base.mp4'))
        output = self.root / 'kino-error'
        dump = engine.dump
        def invalid_cutfile(target, value):
            value = copy.deepcopy(value)
            if target.name == 'cutfile.json':
                value['ops'][0]['src'] = 'unknown'
            return dump(target, value)
        out, err = io.StringIO(), io.StringIO()
        with patch.object(engine, 'dump', side_effect=invalid_cutfile), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = timeline.main(['render', '--plan', str(path), '--output', str(output)])
        self.assertEqual((code, out.getvalue()), (1, ''))
        self.assertIn('Kinocut MCPVideoError code=cutfile_unknown_ref', err.getvalue())
        self.assertNotIn(str(self.root), err.getvalue())
        self.assertFalse(output.exists())
