// 资源图(角色四视图/场景/道具)计费接线:授权 → 成功结算 / 失败释放。
// 与分镜图路由(routes/images.js)同口径:未定价即拒绝调用;
// 无请求上下文的后台链路返回空实现,不重复计费。
const { randomUUID } = require('crypto');
const billingRequestContext = require('./billingRequestContext');

function hasReferenceValue(value) {
  if (Array.isArray(value)) return value.some(hasReferenceValue);
  if (typeof value === 'string') return Boolean(value.trim());
  return Boolean(value);
}

function imagePricingContext(input = {}) {
  return {
    has_image_input: [input.image_url, input.reference_images, input.reference_image_urls]
      .some(hasReferenceValue),
  };
}

function createResourceImageBilling(db, { model, dramaId, sourceId, image_url, reference_images, reference_image_urls } = {}) {
  const ctx = billingRequestContext.current();
  const actor = ctx?.actor;
  if (!actor?.id) {
    return { authorizationId: null, settle() {}, void() {} };
  }
  const aiConfigService = require('./aiConfigService');
  const options = ctx.tenant_id ? { tenant_id: ctx.tenant_id } : {};
  const providerModel = String(model || '').trim();
  const billingTarget = aiConfigService.resolveBillingTarget(db, 'image', providerModel, null, options);
  const billing = require('./billingService');
  const authorization = billing.createAuthorization(db, actor, {
    idempotency_key: `resource-image:${randomUUID()}`,
    service_type: 'image',
    model: billingTarget.billing_key,
    usage: { image: 1 },
    pricing_context: imagePricingContext({ image_url, reference_images, reference_image_urls }),
    reference_type: 'image_generation',
    reference_id: dramaId || null,
    drama_id: dramaId || null,
    source_kind: 'image_generation',
    source_id: sourceId != null ? String(sourceId) : null,
  });
  const authorizationId = authorization.authorization_id;
  return {
    authorizationId,
    settle(log, providerRequestId) {
      try {
        billing.settleAuthorization(db, actor, authorizationId, {
          usage: { image: 1 },
          provider_request_id: providerRequestId,
        });
      } catch (err) {
        log?.error?.('[billing] resource image settlement failed', { authorization_id: authorizationId, error: err.message });
      }
    },
    void(log, reason) {
      try {
        billing.voidAuthorization(db, actor, authorizationId, reason || 'resource image generation failed');
      } catch (err) {
        log?.error?.('[billing] resource image authorization release failed', { authorization_id: authorizationId, error: err.message });
      }
    },
  };
}

module.exports = { createResourceImageBilling, imagePricingContext };
