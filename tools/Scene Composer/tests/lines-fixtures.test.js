'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { fixture, ok } = require('./support.js');
const cases = [
  {
    "narration": "From here, press New board.",
    "lines": [
      {
        "at": {
          "occurrence": 1,
          "word": "From"
        },
        "text": "From here, press New board."
      }
    ]
  },
  {
    "narration": "Give the board a short name, like Tomato beds. [pause] Then press <emphasis>Create board</emphasis>.",
    "lines": [
      {
        "at": {
          "occurrence": 1,
          "word": "Give"
        },
        "text": "Give the board a short name, like Tomato beds."
      },
      {
        "at": {
          "occurrence": 1,
          "word": "Then"
        },
        "text": "Then press Create board."
      }
    ]
  },
  {
    "narration": "Give your board a name, such as Tomato beds. [pause] Then press Create board.",
    "lines": [
      {
        "at": {
          "occurrence": 1,
          "word": "Give"
        },
        "text": "Give your board a name, such as Tomato beds."
      },
      {
        "at": {
          "occurrence": 1,
          "word": "Then"
        },
        "text": "Then press Create board."
      }
    ]
  },
  {
    "narration": "Here are your boards. [pause] To start one, press <emphasis>New board</emphasis>.",
    "lines": [
      {
        "at": {
          "occurrence": 1,
          "word": "Here"
        },
        "text": "Here are your boards."
      },
      {
        "at": {
          "occurrence": 1,
          "word": "To"
        },
        "text": "To start one, press New board."
      }
    ]
  },
  {
    "narration": "In Board name, type a name for your board, such as Tomato beds. [pause] Then press Create board.",
    "lines": [
      {
        "at": {
          "occurrence": 1,
          "word": "In"
        },
        "text": "In Board name, type a name for your board, such as Tomato beds."
      },
      {
        "at": {
          "occurrence": 1,
          "word": "Then"
        },
        "text": "Then press Create board."
      }
    ]
  },
  {
    "narration": "On your new board, press Add a card.",
    "lines": [
      {
        "at": {
          "occurrence": 1,
          "word": "On"
        },
        "text": "On your new board, press Add a card."
      }
    ]
  },
  {
    "narration": "On your new board, press New card.",
    "lines": [
      {
        "at": {
          "occurrence": 1,
          "word": "On"
        },
        "text": "On your new board, press New card."
      }
    ]
  },
  {
    "narration": "Open Pinboard to Your boards. This is where you start.",
    "lines": [
      {
        "at": {
          "occurrence": 1,
          "word": "Open"
        },
        "text": "Open Pinboard to Your boards."
      },
      {
        "at": {
          "occurrence": 1,
          "word": "This"
        },
        "text": "This is where you start."
      }
    ]
  },
  {
    "narration": "Press New board to start one.",
    "lines": [
      {
        "at": {
          "occurrence": 1,
          "word": "Press"
        },
        "text": "Press New board to start one."
      }
    ]
  },
  {
    "narration": "Start by opening Your boards. [pause] You have no boards yet. That's where you begin.",
    "lines": [
      {
        "at": {
          "occurrence": 1,
          "word": "Start"
        },
        "text": "Start by opening Your boards."
      },
      {
        "at": {
          "occurrence": 1,
          "word": "You"
        },
        "text": "You have no boards yet."
      },
      {
        "at": {
          "occurrence": 1,
          "word": "That's"
        },
        "text": "That's where you begin."
      }
    ]
  },
  {
    "narration": "Type a name for the board, such as Tomato beds. [pause] Then press <emphasis>Create board</emphasis>.",
    "lines": [
      {
        "at": {
          "occurrence": 1,
          "word": "Type"
        },
        "text": "Type a name for the board, such as Tomato beds."
      },
      {
        "at": {
          "occurrence": 1,
          "word": "Then"
        },
        "text": "Then press Create board."
      }
    ]
  },
  {
    "narration": "You'll make a board and pin its first card in four steps. [pause] First, open Your boards. Next, press New board. Then, name your board. Press Create board. Finally, press New card.",
    "lines": [
      {
        "at": {
          "occurrence": 1,
          "word": "You'll"
        },
        "text": "You'll make a board and pin its first card in four steps."
      },
      {
        "at": {
          "occurrence": 1,
          "word": "First,"
        },
        "text": "First, open Your boards."
      },
      {
        "at": {
          "occurrence": 1,
          "word": "Next,"
        },
        "text": "Next, press New board."
      },
      {
        "at": {
          "occurrence": 1,
          "word": "Then,"
        },
        "text": "Then, name your board."
      },
      {
        "at": {
          "occurrence": 1,
          "word": "Press"
        },
        "text": "Press Create board."
      },
      {
        "at": {
          "occurrence": 1,
          "word": "Finally,"
        },
        "text": "Finally, press New card."
      }
    ]
  },
  {
    "narration": "You'll make a board and pin its first card. [pause] Open Your boards. Press New board. Name it and press Create board. Then press Add a card.",
    "lines": [
      {
        "at": {
          "occurrence": 1,
          "word": "You'll"
        },
        "text": "You'll make a board and pin its first card."
      },
      {
        "at": {
          "occurrence": 1,
          "word": "Open"
        },
        "text": "Open Your boards."
      },
      {
        "at": {
          "occurrence": 1,
          "word": "Press"
        },
        "text": "Press New board."
      },
      {
        "at": {
          "occurrence": 1,
          "word": "Name"
        },
        "text": "Name it and press Create board."
      },
      {
        "at": {
          "occurrence": 1,
          "word": "Then"
        },
        "text": "Then press Add a card."
      }
    ]
  },
  {
    "narration": "Your new board is open. [pause] Press <emphasis>Add a card</emphasis> to pin its first card.",
    "lines": [
      {
        "at": {
          "occurrence": 1,
          "word": "Your"
        },
        "text": "Your new board is open."
      },
      {
        "at": {
          "occurrence": 1,
          "word": "Press"
        },
        "text": "Press Add a card to pin its first card."
      }
    ]
  },
  {
    "narration": "[pause] Making a board takes four steps. You open your boards, press New board, give the board a name, and add its first card.",
    "lines": [
      {
        "at": {
          "occurrence": 1,
          "word": "Making"
        },
        "text": "Making a board takes four steps."
      },
      {
        "at": {
          "occurrence": 1,
          "word": "You"
        },
        "text": "You open your boards, press New board, give the board a name, and add its first"
      },
      {
        "at": {
          "occurrence": 1,
          "word": "card."
        },
        "text": "card."
      }
    ]
  }
];
for (const [i, value] of cases.entries()) {
  test(`lines matches recorded narration ${i + 1}`, t => {
    const f = fixture(t), input = f.save({ narration: value.narration });
    const result = ok(['lines', '--spec', input, '--output', f.output]);
    assert.deepEqual(result.lines, value.lines);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.output, 'utf8')).lines, value.lines);
  });
}
