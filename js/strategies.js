// The built-in strategies. Every one is written in Pigeon script (see lang.js),
// so the Field guide can show the source and the Lab can fork it.
//
// tags: nice (never defects first), nasty, random (uses chance), classic (Axelrod 1980 era)

export const BUILTINS = [
  {
    id: 'tft',
    name: 'Tit for Tat',
    short: 'TFT',
    tags: ['nice', 'classic'],
    blurb: 'Starts nice, then copies your last move. Won both of Axelrod\'s tournaments with four lines of code.',
    source: `-- Start nice. Then do whatever they did last round.
if round == 1 then return C end
return their.last`,
  },
  {
    id: 'allc',
    name: 'Always Cooperate',
    short: 'ALLC',
    tags: ['nice'],
    blurb: 'Cooperates. Always. Lovely to be around, delicious to exploit.',
    source: `-- Turn the other cheek. And the other one. Forever.
return C`,
  },
  {
    id: 'alld',
    name: 'Always Defect',
    short: 'ALLD',
    tags: ['nasty'],
    blurb: 'Rats you out every single round. Never loses a match, rarely wins a tournament.',
    source: `-- Trust nobody.
return D`,
  },
  {
    id: 'random',
    name: 'Random',
    short: 'RAND',
    tags: ['random', 'classic'],
    blurb: 'Flips a coin. Not evil, not good, just noise with feathers.',
    source: `-- Heads I cooperate, tails I rat.
return mix(0.5)`,
  },
  {
    id: 'grudger',
    name: 'Grudger',
    short: 'GRIM',
    tags: ['nice', 'classic'],
    blurb: 'Cooperates until you defect once. Then never again. Also known as Grim Trigger.',
    source: `-- One strike and you're out. Forever.
if their.ever(D) then return D end
return C`,
  },
  {
    id: 'pavlov',
    name: 'Pavlov',
    short: 'WSLS',
    tags: ['nice'],
    blurb: 'Win-stay, lose-shift. Repeats a move that paid off, switches after a bad one. Shrugs off noise.',
    source: `-- If last round paid well, do it again. If not, switch.
if round == 1 then return C end
if my.payoff == R or my.payoff == T then return my.last end
return flip(my.last)`,
  },
  {
    id: 'gtft',
    name: 'Generous Tit for Tat',
    short: 'GTFT',
    tags: ['nice', 'random'],
    blurb: 'Tit for Tat that sometimes lets a betrayal slide. How often depends on the payoffs.',
    source: `-- Like Tit for Tat, but forgives some betrayals at random.
-- With the classic payoffs it forgives one time in three.
memory g = min(1 - (T - R) / (R - S), (R - P) / (T - P))
if their.last == D and not chance(g) then return D end
return C`,
  },
  {
    id: 'tf2t',
    name: 'Tit for Two Tats',
    short: 'TF2T',
    tags: ['nice', 'classic'],
    blurb: 'Only hits back after two betrayals in a row. Patient, and easy to milk.',
    source: `-- Retaliate only after two betrayals in a row.
if their[1] == D and their[2] == D then return D end
return C`,
  },
  {
    id: 'ttft',
    name: 'Two Tits for Tat',
    short: '2TFT',
    tags: ['nice'],
    blurb: 'Every betrayal costs you two rounds of payback.',
    source: `-- Hit back twice for every hit.
if their[1] == D or their[2] == D then return D end
return C`,
  },
  {
    id: 'stft',
    name: 'Suspicious Tit for Tat',
    short: 'STFT',
    tags: ['nasty'],
    blurb: 'Tit for Tat with trust issues: opens with a defection.',
    source: `-- Assume the worst. Then copy them.
if round == 1 then return D end
return their.last`,
  },
  {
    id: 'hardtft',
    name: 'Hard Tit for Tat',
    short: 'HTFT',
    tags: ['nice'],
    blurb: 'Defects if you defected in any of the last three rounds. Long memory, short fuse.',
    source: `-- Defect if they defected in any of the last three rounds.
if their.count(D, 3) > 0 then return D end
return C`,
  },
  {
    id: 'softgrudger',
    name: 'Soft Grudger',
    short: 'SGRD',
    tags: ['nice'],
    blurb: 'Punishes a betrayal with four defections, then offers two cooperations to make up.',
    source: `-- Betray me and you get D D D D, then C C to make peace.
memory left = 0
if left > 0 then
  left = left - 1
  if left >= 2 then return D end
  return C
end
if their.last == D then
  left = 5
  return D
end
return C`,
  },
  {
    id: 'gradual',
    name: 'Gradual',
    short: 'GRAD',
    tags: ['nice'],
    blurb: 'Answers your n-th betrayal with n defections, then two cooperations to calm things down.',
    source: `-- Your 1st betrayal costs you 1 round, your 5th costs you 5.
-- After every punishment, two rounds of peace.
memory angry = 0, calm = 0
if angry > 0 then
  angry = angry - 1
  if angry == 0 then calm = 2 end
  return D
end
if calm > 0 then
  calm = calm - 1
  return C
end
if their.last == D then
  angry = their.defections - 1
  if angry == 0 then calm = 2 end
  return D
end
return C`,
  },
  {
    id: 'joss',
    name: 'Joss',
    short: 'JOSS',
    tags: ['random', 'classic'],
    blurb: 'Tit for Tat with a sneaky streak: one time in ten it defects anyway.',
    source: `-- Tit for Tat, but stab them in the back 10% of the time.
if round == 1 then return C end
if their.last == C and chance(0.1) then return D end
return their.last`,
  },
  {
    id: 'tester',
    name: 'Tester',
    short: 'TEST',
    tags: ['nasty', 'classic'],
    blurb: 'Opens with a defection to see if you notice. If you hit back it apologises and plays Tit for Tat; if not, it farms you.',
    source: `-- Poke them. If they poke back, apologise and behave.
-- If they don't, defect every other round.
memory sorry = false
if round == 1 then return D end
if sorry then return their.last end
if their.last == D then
  sorry = true
  return C
end
if round <= 3 then return C end
if round % 2 == 0 then return D end
return C`,
  },
  {
    id: 'prober',
    name: 'Prober',
    short: 'PROB',
    tags: ['nasty'],
    blurb: 'Opens D, C, C. If you let the first defection slide, it decides you are a sucker for good.',
    source: `-- Open with D, C, C. If they didn't punish the D, exploit them forever.
if round == 1 then return D end
if round <= 3 then return C end
if their.at(2) == C and their.at(3) == C then return D end
return their.last`,
  },
  {
    id: 'softmajo',
    name: 'Soft Majority',
    short: 'SMAJ',
    tags: ['nice'],
    blurb: 'Cooperates as long as you have cooperated at least as often as you defected.',
    source: `-- Go with their overall track record. Ties go to trust.
if their.defections > their.cooperations then return D end
return C`,
  },
  {
    id: 'hardmajo',
    name: 'Hard Majority',
    short: 'HMAJ',
    tags: ['nasty'],
    blurb: 'Defects unless you have cooperated more often than you defected. Ties go to suspicion.',
    source: `-- Go with their overall track record. Ties go to suspicion.
if their.defections >= their.cooperations then return D end
return C`,
  },
  {
    id: 'alternator',
    name: 'Alternator',
    short: 'ALT',
    tags: ['nasty'],
    blurb: 'C, D, C, D, C, D. Ignores you completely.',
    source: `-- Cooperate on odd rounds, defect on even ones.
if round % 2 == 1 then return C end
return D`,
  },
  {
    id: 'extort2',
    name: 'Extort-2',
    short: 'EXT2',
    tags: ['random'],
    blurb: 'A zero-determinant extortioner (Press and Dyson, 2012). Whatever you gain over mutual defection, it gains twice.',
    source: `-- Probability of cooperating depends only on last round.
-- Tuned so it always gets twice your surplus. With classic payoffs.
if round == 1 then return C end
if my.last == C and their.last == C then return mix(8 / 9) end
if my.last == C then return mix(1 / 2) end
if their.last == C then return mix(1 / 3) end
return D`,
  },
  {
    id: 'handshake',
    name: 'Handshake',
    short: 'HSHK',
    tags: ['nasty'],
    blurb: 'Opens with a secret greeting: D then C. Answer the same and it is family. Anything else means war.',
    source: `-- Secret handshake: D, then C. Same greeting back = friend. Otherwise war.
if round == 1 then return D end
if round == 2 then return C end
if their.at(1) == D and their.at(2) == C then return C end
return D`,
  },
  {
    id: 'mo',
    name: 'Mo',
    short: 'MO',
    tags: ['nice'],
    blurb: 'The house pigeon. Plays Tit for Tat until your third betrayal. After that you are dead to him.',
    source: `-- Don't piss me off.
-- Tit for Tat, but three betrayals and that's it. Forever.
if their.defections >= 3 then return D end
if round == 1 then return C end
return their.last`,
  },
];

// The lineup a tournament starts with: the classics plus a few troublemakers.
export const DEFAULT_LINEUP = [
  'tft', 'allc', 'alld', 'random', 'grudger', 'pavlov', 'gtft', 'tf2t',
  'stft', 'gradual', 'joss', 'tester', 'prober', 'extort2', 'mo',
];

// The reference field a Lab strategy is tested against.
export const TEST_FIELD = [
  'tft', 'allc', 'alld', 'random', 'grudger', 'pavlov', 'gtft', 'tf2t', 'stft', 'gradual', 'joss', 'prober', 'extort2',
];

export const STARTER_SOURCE = `-- Your strategy. Return C to cooperate, D to rat.
-- Tip: open "Language" for everything you can use.
memory burned = 0

if round == 1 then return C end

-- Keep score of betrayals.
if their.last == D then burned = burned + 1 end

-- Forgive the first one, punish the rest.
if burned > 1 and their.last == D then return D end
return C`;
