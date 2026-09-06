// Independent engineering fixture: public examples may be renamed or removed.
export const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
export const slides = [
  { layout: 'cover', title: '封面标题', subtitle: '封面副标题', metrics: [{ value: '42%', label: '指标' }] },
  { layout: 'section', number: '01', title: '章节标题', subtitle: '章节说明' },
  { layout: 'agenda', title: '目录', items: ['第一章', '第二章', '第三章'] },
  { layout: 'cards', title: '卡片页', items: [{ title: '观点一', body: '简短说明' }, { title: '观点二', body: '简短说明' }, { title: '观点三', body: '简短说明' }] },
  { layout: 'metrics', title: '指标页', items: [{ value: '18', label: '项目', detail: '同比提升' }, { value: '92%', label: '完成率', detail: '保持稳定' }], insight: '数据说明与行动建议。' },
  { layout: 'split', title: '图文页', image: { data: pixel }, imageSide: 'right', contentTitle: '核心结论', body: '正文说明。', bullets: ['要点一', '要点二'] },
  { layout: 'comparison', title: '对比页', left: { title: '当前', items: ['问题一', '问题二'] }, right: { title: '目标', items: ['收益一', '收益二'] } },
  { layout: 'timeline', title: '时间线', items: [{ date: '01', title: '开始', body: '完成准备' }, { date: '02', title: '交付', body: '完成验证' }] },
  { layout: 'chart-insight', title: '图表页', chart: { chartType: 'bar', labels: ['A', 'B'], data: [{ name: '系列', values: [-1, 2] }] }, insights: ['趋势向上', '重点关注 B'] },
  { layout: 'quote', quote: '一句值得强调的核心观点。', source: '示例来源' },
  { layout: 'ending', title: '感谢聆听', subtitle: '下一步开始行动' },
  { layout: 'raw', elements: [
    { elType: 'table', x: 80, y: 80, width: 500, height: 160, rows: [['项', '值'], ['A', '1']] },
    { elType: 'chart', chartType: 'scatter', x: 650, y: 80, width: 480, height: 300, data: [{ name: 'S1', values: [[-1, 2], [3, 4]] }, { name: 'S2', values: [[2, -3], [2, 5]] }] },
    { elType: 'connector-s', x1: 80, y1: 400, x2: 500, y2: 500, stroke: '$primary' },
  ] },
];
export default { dslVersion: 3, style: 'clean-minimal', slides };
