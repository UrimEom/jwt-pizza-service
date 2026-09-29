const request = require('supertest');
const app = require('./src/service');

test('GET / returns the welcome message', async () => {
  const response = await request(app).get('/');

  expect(response.statusCode).toBe(200);
  expect(response.body.message).toBe('welcome to JWT Pizza');
});