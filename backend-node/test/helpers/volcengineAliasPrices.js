const charge = (Type, Price, extra = {}) => ({ Type, Price, OriginalPrice: extra.OriginalPrice ?? Price, UnitCode: extra.UnitCode || '千tokens', ...extra });
const item = (FoundationModelName, groups) => ({ FoundationModelName, MultiChargeItems: groups.map((ChargeItems) => ({ ChargeItems })) });
const fixtures = [
  item('doubao-seed-2-0-lite', [
    [charge('InferencePrompt', 0.0006), charge('InferenceCompletion', 0.0036)],
    [charge('InferencePrompt', 0.0009), charge('InferenceCompletion', 0.0054)],
    [charge('InferencePrompt', 0.0018), charge('InferenceCompletion', 0.0108)],
  ]),
  item('doubao-seed-2-1-turbo', [[charge('InferencePrompt', 0.003), charge('InferenceCompletion', 0.015)]]),
  item('doubao-seedance-2-0', [[charge('V2VCompletion', 0.028), charge('NV2VCompletion', 0.046), charge('V2V1080Completion', 0.031), charge('NV2V1080Completion', 0.051), charge('V2V4KCompletion', 0.016), charge('NV2V4KCompletion', 0.026)]]),
  item('doubao-seedance-2-0-fast', [[charge('V2VCompletion', 0.0165, { OriginalPrice: 0.022 }), charge('NV2VCompletion', 0.02775, { OriginalPrice: 0.037 })]]),
  item('doubao-seedance-2-0-mini', [[charge('V2VCompletion', 0.0056, { OriginalPrice: 0.014, DiscountPriceStartTime: '2026-08-07T14:00:00+08:00', DiscountPriceEndTime: '2026-09-07T14:00:00+08:00' }), charge('NV2VCompletion', 0.0092, { OriginalPrice: 0.023, DiscountPriceStartTime: '2026-08-07T14:00:00+08:00', DiscountPriceEndTime: '2026-09-07T14:00:00+08:00' })]]),
  item('doubao-seedance-2-5', [[charge('V2VCompletion', 0.042), charge('NV2VCompletion', 0.07), charge('V2V1080Completion', 0.03312, { OriginalPrice: 0.046, DiscountPriceStartTime: '2026-08-14T14:00:00+08:00', DiscountPriceEndTime: '2026-09-17T14:00:00+08:00' }), charge('NV2V1080Completion', 0.05544, { OriginalPrice: 0.077, DiscountPriceStartTime: '2026-08-14T14:00:00+08:00', DiscountPriceEndTime: '2026-09-17T14:00:00+08:00' })]]),
];

module.exports = fixtures;
