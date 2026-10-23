/**
 * Core's own rule fragment, loaded in every project after the packs' and the project's
 * rules. It holds only the process rules; a pack's test-layer rule names `core:tdd` itself,
 * so core never needs to know which packs exist.
 */

/** Starting on a piece of work, which is built test-first whatever the stack. */
const IMPLEMENTATION = /\bpick(ed|ing)? ?up\b|\bissue #?\d+|\bslice \d+\b|\bnext slice\b|\bimplement\w*\b/i
const TESTING = /\btdd\b|\bred[- ]green\b|\btests?\b|\btesting\b|\bspecs?\b/i
const BUG = /\bbugs?\b|\bbroken\b|\bfailing\b|\bregressions?\b/i

export default {
  skills: {
    prompts: [
      {
        id: 'tdd',
        pattern: new RegExp([TESTING.source, IMPLEMENTATION.source, BUG.source].join('|'), 'i'),
        skills: ['core:tdd'],
        why: 'one test per red-green cycle, and a bug fix starts with a failing test.',
      },
      {
        id: 'grill-with-docs',
        pattern: /\bplan\b|\bplanning\b|\bdesign (a|the|this)\b|\bapproach\b|how should (we|i)\b|\bstress[- ]test\b/i,
        skills: ['core:grill-with-docs'],
        why: 'align in the conversation, never with EnterPlanMode/ExitPlanMode.',
      },
      {
        id: 'write-a-skill',
        pattern: /\b(write|writing|create|creating|author|authoring|new|add)\b[^.!?]{0,40}\bskills?\b/i,
        skills: ['core:write-a-skill'],
        why: 'a SKILL.md is drafted against its principles, not freehand.',
      },
      {
        id: 'handoff',
        pattern: /\bhand ?off\b|\bhand (it |this )?over\b|\bnext session\b|\bfresh (session|agent)\b/i,
        skills: ['core:handoff'],
        why: 'the handoff goes to the OS temp directory and points at artifacts instead of restating them.',
      },
    ],
  },
}
