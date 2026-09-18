const response = require('../response');
const boards = require('../services/creativeBoardService');
const deliveries = require('../services/creativeBoardDeliveryService');

module.exports = function routes(db, log) { return {
  list(req, res) { try { response.success(res, boards.list(db, req.auth.id)); } catch (e) { response.internalError(res, e.message); } },
  create(req, res) { try { response.created(res, boards.create(db, req.auth.id, req.body?.name)); } catch (e) { response.badRequest(res, e.message); } },
  get(req, res) { try { const board = boards.assertBoard(db, req.params.id, req.auth.id); response.success(res, boards.detail(db, board, req.auth.id)); } catch (e) { response.notFound(res, e.message); } },
  update(req, res) { try { response.success(res, boards.update(db, req.params.id, req.auth.id, req.body)); } catch (e) { if (e.code === 'VERSION_CONFLICT') response.error(res, 409, e.code, e.message); else response.badRequest(res, e.message); } },
  remove(req, res) { try { response.success(res, boards.remove(db, req.params.id, req.auth.id)); } catch (e) { response.notFound(res, e.message); } },
  deliveries(req, res) { try { response.success(res, deliveries.list(db, req.params.id, req.auth.id)); } catch (e) { response.notFound(res, e.message); } },
  delivery(req, res) { try { const item = deliveries.ownedDelivery(db, req.params.deliveryId, req.auth.id); if (Number(item.board_id) !== Number(req.params.id)) throw new Error('交付任务不属于该画布'); response.success(res, item); } catch (e) { response.notFound(res, e.message); } },
  async createDelivery(req, res) { try { response.created(res, await deliveries.create(db, log, req.params.id, req.auth.id, req.body)); } catch (e) { response.badRequest(res, e.message); } },
}; };
