// One-off: populate a page with an editorial outline of The Odyssey, Book I.
// Summary is paraphrased (modern translations are copyrighted). Run:
//   node scripts/seed-odyssey.mjs
const API = process.env.TEND_API || 'http://localhost:3000/api/v1'
const NAME = 'The Odyssey - Book I'

// tree: array of { content, children? }
const tree = [
  { content: '# The Odyssey — Book I: Athena Inspires the Prince' },
  {
    content: 'Invocation of the Muse',
    children: [
      { content: 'The poet calls on the Muse to tell of the man of many turns — Odysseus, who wandered far after he sacked the sacred city of Troy.' },
      { content: 'He saw the cities of many peoples and learned their minds, and suffered many pains upon the open sea, fighting to save his life and bring his companions home.' },
      { content: 'Yet he could not save them: they perished by their own recklessness, having devoured the cattle of Helios, the Sun, who took from them the day of their return.' },
      { content: 'Of these things, the poet asks, begin the tale wherever you will, goddess, daughter of Zeus.' },
    ],
  },
  {
    content: 'The council of the gods on Olympus',
    children: [
      { content: 'By now all the other heroes who had escaped death were safe at home — only Odysseus remained, held far from wife and homeland by the nymph Calypso on her island, who longed to make him her husband.' },
      {
        content: 'Poseidon alone still nursed his anger against Odysseus, but the sea-god was away feasting among the distant Ethiopians, so the gods gathered in the halls of Zeus.',
        children: [
          { content: 'Zeus mused aloud on Aegisthus, lately killed by Orestes — proof, he said, that mortals blame the gods for sorrows they bring on themselves through their own blind folly.' },
        ],
      },
      {
        content: 'Athena seized the moment to plead for Odysseus.',
        children: [
          { content: 'Her heart was torn for him, stranded and grieving on Calypso’s isle, aching only to see the smoke rising from his own land and then to die.' },
          { content: 'She asked why Zeus was so set against him, when Odysseus had always honored the gods with sacrifice.' },
        ],
      },
      {
        content: 'Zeus answered that he had not forgotten Odysseus — it was Poseidon’s grudge that kept him from home.',
        children: [
          { content: 'Odysseus had blinded the Cyclops Polyphemus, Poseidon’s son, and the sea-god’s wrath had hounded him ever since, though he would not destroy him outright.' },
          { content: 'The gods agreed on a plan: since Poseidon was absent, they would contrive Odysseus’s return, and Poseidon must yield to the will of all.' },
        ],
      },
      {
        content: 'The twofold plan',
        children: [
          { content: 'Hermes the messenger would go to Ogygia to tell Calypso that Odysseus must be let go.' },
          { content: 'Athena herself would go to Ithaca to rouse Odysseus’s son, Telemachus, to action.' },
        ],
      },
    ],
  },
  {
    content: 'Athena comes to Ithaca, disguised as Mentes',
    children: [
      { content: 'Taking the form of Mentes, a chieftain of the Taphians, she went down to Ithaca and stood at the gates of Odysseus’s house.' },
      {
        content: 'She found the suitors of Penelope lounging before the doors, playing at dice, feasting on Odysseus’s cattle and drinking his wine — devouring his household as they courted his wife.',
        children: [
          { content: 'Telemachus, sitting unhappy among them, was first to see the stranger and, ashamed that a guest should stand waiting, hurried to welcome her.' },
          { content: 'He took her spear, seated her, and set food before her, apart from the noise of the suitors so they might speak.' },
          { content: 'Phemius the bard was made to sing for the suitors’ pleasure, against his will.' },
        ],
      },
    ],
  },
  {
    content: 'The counsel of Athena/Mentes',
    children: [
      { content: 'Telemachus confided that the house was being ruined, that his father was surely dead somewhere far away, and that the noblest lords of the islands were pressing his mother to marry.' },
      { content: 'Athena assured him Odysseus still lived, delayed but not destroyed, and that he would find his way home — for no chains could hold so resourceful a man forever.' },
      {
        content: 'She urged Telemachus to act like a man and no longer a child:',
        children: [
          { content: 'Call the Achaeans to assembly and order the suitors to disperse to their own homes.' },
          { content: 'Then fit out a ship and sail in search of news of his father — to Pylos, to question old Nestor, and to Sparta, to Menelaus, last of the Achaeans to come home.' },
          { content: 'If he learned his father was dead, he should raise a tomb, give funeral honors, and see his mother wed; if alive, he should endure one year more in hope.' },
          { content: 'She reminded him how Orestes won glory by avenging his father — a spur to Telemachus to win a name of his own.' },
        ],
      },
    ],
  },
  {
    content: 'Telemachus transformed',
    children: [
      { content: 'Athena departed, vanishing like a bird into the air, and left strength and daring in his heart; he sensed that his visitor had been a god.' },
      { content: 'He returned to the suitors a changed man, filled with new resolve.' },
    ],
  },
  {
    content: 'Penelope, the song, and a son’s new voice',
    children: [
      { content: 'Phemius sang of the bitter homecoming of the Achaeans from Troy, and Penelope, hearing it from her chamber, came down in tears and begged him to choose another song.' },
      {
        content: 'Telemachus checked his mother, gently but firmly.',
        children: [
          { content: 'He told her the bard should sing as he was moved, and that Odysseus was not the only man who never came home from Troy.' },
          { content: 'He bade her return to her weaving and her maids and leave matters of speech to the men — for he was now master of the house. Amazed, she withdrew.' },
        ],
      },
      {
        content: 'Telemachus then rounded on the suitors.',
        children: [
          { content: 'He announced an assembly at dawn, where he would order them to leave and feast at their own cost.' },
          { content: 'Antinous mocked his bold new tongue; Eurymachus asked slyly who the departed stranger had been and whether he brought news of Odysseus. Telemachus answered only that it was an old family friend, Mentes.' },
        ],
      },
    ],
  },
  {
    content: 'Nightfall',
    children: [
      { content: 'When the suitors at last turned to their beds, Telemachus went up to his chamber, lit by the faithful old nurse Eurycleia, who had cared for him since childhood.' },
      { content: 'There he lay awake through the night, wrapped in a fleece, turning over in his mind the journey Athena had set before him.' },
    ],
  },
]

let blocks = []
function walk(node, parentUuid) {
  const uuid = crypto.randomUUID()
  const children = (node.children || []).map((c) => walk(c, uuid))
  blocks.push({
    uuid,
    content: node.content,
    parent_uuid: parentUuid,
    children,
    collapsed: false,
    properties: {},
  })
  return uuid
}
tree.forEach((n) => walk(n, null))

const res = await fetch(`${API}/pages/${encodeURIComponent(NAME)}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ blocks, version: null }),
})
if (!res.ok) {
  console.error(`PUT failed: HTTP ${res.status}`, await res.text())
  process.exit(1)
}
console.log(`Seeded "${NAME}" with ${blocks.length} blocks.`)
