/**
 * 从 fontkit `src/tables/variations.js` 裁出的 **ItemVariationStore 子集**。
 *
 * 为什么裁：原文件顶部 `import {Feature} from './opentype'`，而 Feature 只被本文末尾的
 * `FeatureVariations`（CFF 写回完全用不到）引用。保留整份会把 opentype 表族拖进打包树。
 * 裁掉的只有 FeatureVariations / FeatureTableSubstitution / ConditionSet 三组，
 * **ItemVariationStore 及其依赖（VariationRegionList / ItemVariationData / DeltaSet）逐字未改**。
 *
 * 上游：fontkit 2.0.4 · src/tables/variations.js · MIT · 见 SOURCES.md
 */
import * as r from '../restructure/index.js';

let F2DOT14 = new r.Fixed(16, 'BE', 14);

let RegionAxisCoordinates = new r.Struct({
  startCoord: F2DOT14,
  peakCoord: F2DOT14,
  endCoord: F2DOT14,
});

let VariationRegionList = new r.Struct({
  axisCount: r.uint16,
  regionCount: r.uint16,
  variationRegions: new r.Array(new r.Array(RegionAxisCoordinates, 'axisCount'), 'regionCount'),
});

let DeltaSet = new r.Struct({
  shortDeltas: new r.Array(r.int16, (t) => t.parent.shortDeltaCount),
  regionDeltas: new r.Array(r.int8, (t) => t.parent.regionIndexCount - t.parent.shortDeltaCount),
  deltas: (t) => t.shortDeltas.concat(t.regionDeltas),
});

let ItemVariationData = new r.Struct({
  itemCount: r.uint16,
  shortDeltaCount: r.uint16,
  regionIndexCount: r.uint16,
  regionIndexes: new r.Array(r.uint16, 'regionIndexCount'),
  deltaSets: new r.Array(DeltaSet, 'itemCount'),
});

export let ItemVariationStore = new r.Struct({
  format: r.uint16,
  variationRegionList: new r.Pointer(r.uint32, VariationRegionList),
  variationDataCount: r.uint16,
  itemVariationData: new r.Array(new r.Pointer(r.uint32, ItemVariationData), 'variationDataCount'),
});
