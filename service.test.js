jest.mock('./src/database/database.js', () => ({
   DB: {
     isLoggedIn: jest.fn().mockResolvedValue(false),
     getMenu: jest.fn().mockResolvedValue([
       { id: 1, title: 'Veggie', price: 0.05 },
     ]),
   },
   Role: {
     Diner: 'diner',
     Franchisee: 'franchisee',
     Admin: 'admin',
   },
 }));
 
const request = require('supertest');
const app = require('./src/service');

test('GET / returns the welcome message', async () => {
  const response = await request(app).get('/');

  expect(response.statusCode).toBe(200);
  expect(response.body.message).toBe('welcome to JWT Pizza');
});