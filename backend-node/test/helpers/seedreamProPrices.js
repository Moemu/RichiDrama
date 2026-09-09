const model = 'doubao-seedream-5-0-pro';
const chargeItems = [
  ['ToILargeCompletion', 0.36, 0.6], ['ToIPrompt', 0.012, 0.02],
  ['ToICompletion', 0.18, 0.3], ['ToILayerLargeCompletion', 0.18, 0.3],
  ['ToILayerCompletion', 0.09, 0.15],
].map(([Type, Price, OriginalPrice]) => ({ Type, Price, OriginalPrice, UnitCode: '张' }));
const activation = { FoundationModelName: model, DisplayName: 'Doubao-Seedream-5.0-pro', ChargeItems: chargeItems, MultiChargeItems: [{ ChargeItems: chargeItems }] };
module.exports = { model, activation };
