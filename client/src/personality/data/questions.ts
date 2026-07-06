import type { QuizQuestion } from './types'

export const questions: QuizQuestion[] = [
  {
    id: 'q1',
    kicker: 'Q1 / 紧急通知',
    title: '钻进被窝准备睡了，手机突然通知：明早 8 点要交一个你还没开始的东西。',
    options: [
      { id: 'A', text: '把手机塞进枕头底下，假装这条通知有延迟。', scores: ['BEDX'] },
      { id: 'B', text: '起来硬干，半夜也得保住一个体面的明天。', scores: ['FINE'] },
      { id: 'C', text: '先刷点别的缓缓，假装自己已经进入状态。', scores: ['F1SH'] },
      { id: 'D', text: '打开电脑搜搜有没有更省力的野路子。', scores: ['SIDE'] },
    ],
  },
  {
    id: 'q2',
    kicker: 'Q2 / 被迫发言',
    title: '你正安静吃饭，有人突然把麦塞过来：“来，你讲两句。”',
    options: [
      { id: 'A', text: '整个人僵住，剧本里也没这台词啊。', scores: ['BUFR'] },
      { id: 'B', text: '心里吐槽：这局谁排的，出来走两步。', scores: ['JANK'] },
      { id: 'C', text: '先接住场面，笑着把话圆下去。', scores: ['SPRK'] },
      { id: 'D', text: '脸一下就热了，整个人快炸。', scores: ['MUT8'] },
    ],
  },
  {
    id: 'q3',
    kicker: 'Q3 / 深夜语音',
    title: '凌晨 1:24，你收到一条 59 秒语音，配文只有“先听下”。',
    options: [
      { id: 'A', text: '拇指在屏幕上方悬了很久，最后锁屏。', scores: ['GONE'] },
      { id: 'B', text: '打了一大段，又一句句删干净。', scores: ['UNDO'] },
      { id: 'C', text: '瞬间清醒，点开语音认真听。', scores: ['NOCT'] },
      { id: 'D', text: '先回一句更轻的，把气氛先垫软。', scores: ['SPRK'] },
    ],
  },
  {
    id: 'q4',
    kicker: 'Q4 / 朋友圈回声',
    title: '你深夜发了条有点发疯的朋友圈，第二天发现不该看到的人点了赞。',
    options: [
      { id: 'A', text: '装作没事滑走，只要我稳，没人知道。', scores: ['FINE'] },
      { id: 'B', text: '立刻删除，想把它从时间线扣掉。', scores: ['GONE'] },
      { id: 'C', text: '赶紧补一条日常的，把气氛带跑。', scores: ['SPRK'] },
      { id: 'D', text: '思考对方平时不点赞为何这条点赞。', scores: ['JANK'] },
    ],
  },
  {
    id: 'q5',
    kicker: 'Q5 / 清醒开机',
    title: '你刚准备睡，脑子却突然清醒得不像自己的。',
    options: [
      { id: 'A', text: '翻身继续赖着，清醒可以，但别叫我动。', scores: ['BEDX'] },
      { id: 'B', text: '刷短视频，让时间自己滑过去。', scores: ['F1SH'] },
      { id: 'C', text: '借着清醒立马开启一个新项目。', scores: ['SIDE'] },
      { id: 'D', text: '干脆起来活动一下，今天才算正式开场。', scores: ['NOCT'] },
    ],
  },
  {
    id: 'q6',
    kicker: 'Q6 / 临时群聊',
    title: '这个群的名字叫"今晚必须出来"。',
    options: [
      { id: 'A', text: '默默点开成员列表，看看熟人多不多。', scores: ['BUFR'] },
      { id: 'B', text: '潜水一会儿，等群真冷了再决定。', scores: ['SPRK'] },
      { id: 'C', text: '私聊问一句：到底什么局。', scores: ['BEDX'] },
      { id: 'D', text: '群里随手丢个表情包，假装自己一直在。', scores: ['GONE'] },
    ],
  },
  {
    id: 'q7',
    kicker: 'Q7 / 语音回放',
    title: '你刚发完一条语音，回放第一秒就听出问题了。',
    options: [
      { id: 'A', text: '立刻撤回，假装无事发生。', scores: ['BEDX'] },
      { id: 'B', text: '撤回+重录，丝滑一条龙。', scores: ['UNDO'] },
      { id: 'C', text: '立刻补一句文字，把话头带跑。', scores: ['SIDE'] },
      { id: 'D', text: '装作没回放过，硬等对方反应。', scores: ['FINE'] },
    ],
  },
  {
    id: 'q8',
    kicker: 'Q8 / 拖延现场',
    title: '你打开电脑准备处理拖了一周的事，半小时后最可能发生什么？',
    options: [
      { id: 'A', text: '先点了 5 个不相关的链接。', scores: ['SIDE'] },
      { id: 'B', text: '切走，假装刚才没打开过那件事。', scores: ['F1SH'] },
      { id: 'C', text: '反复回看前面哪步歪了，越看越想重来。', scores: ['UNDO'] },
      { id: 'D', text: '干着干着突然累得瘫在椅子上。', scores: ['MUT8'] },
    ],
  },
  {
    id: 'q9',
    kicker: 'Q9 / 房门关上',
    title: '你回到自己房间，门一关，外面的世界先下线了。',
    options: [
      { id: 'A', text: '手机再见，拥抱自己的小床。', scores: ['GONE'] },
      { id: 'B', text: '开启网上冲浪，忘掉白天的自己。', scores: ['NOCT'] },
      { id: 'C', text: '进浴室开热水，让整个人慢慢重启。', scores: ['BUFR'] },
      { id: 'D', text: '打开备忘录，记录今天疲惫的一天。', scores: ['JANK'] },
    ],
  },
  {
    id: 'q10',
    kicker: 'Q10 / 错发瞬间',
    title: '你想和朋友吐槽，消息却错发到不该发的地方。',
    options: [
      { id: 'A', text: '深呼吸两秒，假装这条会被网络吞掉。', scores: ['F1SH'] },
      { id: 'B', text: '盯着对话框，回忆自己怎么就发错了。', scores: ['UNDO'] },
      { id: 'C', text: '心跳拉满，手指在屏幕上抖。', scores: ['MUT8'] },
      { id: 'D', text: '先把表情稳住，给自己抢几秒反应时间。', scores: ['FINE'] },
    ],
  },
]
