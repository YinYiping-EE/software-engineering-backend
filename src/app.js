import express from 'express';
import {calculate, CalculationError} from './calculator.js';
import {readClientInfo} from './client-info.js';
import {protection} from './protection.js';
import {createStatusReader} from './system-status.js';

export function createApp(store, {trustProxy = false, getStatus = createStatusReader(), ...securityOptions} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use('/api', protection(securityOptions));
  app.use(express.json({limit: '2kb', strict: true}));
  app.get('/api/health', (_request, response) => {
    response.json({success: true, status: 'ok', service: 'calculator-api'});
  });
  app.get('/api/status', (_request, response) => {
    store.checkHealth();
    response.json({success: true, status: 'online', ...getStatus()});
  });
  app.post('/api/calculations', (request, response, next) => {
    try {
      const calculation = calculate(request.body?.expression);
      response.status(201).json({success: true, ...store.save(calculation, readClientInfo(request), request.ownerId)});
    } catch (error) {
      if (error instanceof CalculationError) {
        response.status(400).json({success: false, message: error.message});
      } else next(error);
    }
  });
  app.get('/api/calculations', (request, response) => {
    const limit = Number(request.query.limit ?? 20);
    const offset = Number(request.query.offset ?? 0);
    if (Object.keys(request.query).some((key) => !['limit', 'offset'].includes(key)) ||
        Object.values(request.query).some((value) => typeof value !== 'string') ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
        !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
      return response.status(400).json({success: false, message: '分页参数不正确'});
    }
    response.json({success: true, ...store.list(limit, offset, request.ownerId)});
  });
  app.delete('/api/calculations/:id', (request, response) => {
    if (!/^[0-9a-f-]{36}$/.test(request.params.id) || !store.remove(request.params.id, request.ownerId)) {
      return response.status(404).json({success: false, message: '记录不存在'});
    }
    response.status(204).end();
  });
  app.use('/api', (_request, response) => {
    response.status(404).json({success: false, message: '接口不存在'});
  });
  app.use((error, _request, response, _next) => {
    const status = error.status === 400 ? 400 : error.status === 413 ? 413 : 500;
    response.status(status).json({
      success: false,
      message: status === 400 ? '请求格式不正确' : status === 413 ? '请求内容过大' : '服务暂时不可用',
    });
  });
  return app;
}
