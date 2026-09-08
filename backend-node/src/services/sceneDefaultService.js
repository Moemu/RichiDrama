const VERSION = 'capability-default-v1';
const scenes = {
  text: 'default_text_generation', image: 'default_resource_image_generation',
  storyboard_image: 'default_storyboard_image_generation', video: 'default_video_generation',
};

function validate(db, input) {
  if (input.routing_version !== VERSION) return;
  if (scenes[input.service_type] !== input.key) throw new Error('业务默认场景与模型能力不匹配');
  const config = require('./aiConfigService').getConfig(db, Number(input.config_id));
  const compatible = config?.service_type === input.service_type ||
    (input.service_type === 'storyboard_image' && config?.provider_connection_id && config.service_type === 'image');
  if (!config || !config.is_active || !compatible || config.owner_tenant_id) throw new Error('请选择同能力的已启用平台模型绑定');
  if (!config.model.includes(input.model_override)) throw new Error('模型不属于所选连接');
  require('./modelCatalogService').assertAvailable(db, config.service_type, input.model_override);
}

function apply(db, type, configs) {
  if (!scenes[type]) return configs;
  const row = db.prepare('SELECT config_id,model_override FROM ai_model_map WHERE key=? AND routing_version=?').get(scenes[type], VERSION);
  if (!row) return configs;
  // Tenant bindings remain authoritative. A global scene never grants access
  // to a connection that is absent from this group's allowed configurations.
  const selected = configs.find(config => config.id === row.config_id && config.is_active && config.model.includes(row.model_override));
  if (!selected) return configs;
  return [{ ...selected, default_model: row.model_override, is_default: true, scene_default: true },
    ...configs.filter(config => config.id !== selected.id).map(config => ({ ...config, is_default: false }))];
}

module.exports = { VERSION, scenes, validate, apply };
