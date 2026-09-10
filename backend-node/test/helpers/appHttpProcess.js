const { createApp } = require('../../src/app');

const { app } = createApp();
const server = app.listen(Number(process.env.FIXTURE_PORT || 0), process.env.FIXTURE_HOST || '127.0.0.1', () => {
  if (process.send) process.send({ port: server.address().port });
});
