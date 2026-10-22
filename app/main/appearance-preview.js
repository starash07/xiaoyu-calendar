// 两个日历共用一条临时外观通路；清空后各自回到已保存的设置。
const A = require('../renderer/shared/appearance');

function applyAppearancePreview(w1, w2, value) {
  const appearance = value == null ? null : A.normalize(value);
  w1.previewAppearance(appearance);
  w2.send('w2:preview', appearance);
}

module.exports = { applyAppearancePreview };
