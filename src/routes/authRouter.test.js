const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database.js');

if (process.env.VSCODE_INSPECTOR_OPTIONS) {
   jest.setTimeout(60 * 1000 * 5); // 5 minutes while debugging
}

const testUser = {
  name: 'pizza diner',
  email: 'reg@test.com',
  password: 'a',
};

let testUserAuthToken;
let adminUser;
let adminAuthToken;

beforeAll(async () => {
  testUser.email = `${randomName()}@test.com`;

  const registerRes = await request(app)
    .post('/api/auth')
    .send(testUser);

  expect(registerRes.status).toBe(200);
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);

  adminUser = await createAdminUser();

  const adminLoginRes = await request(app)
    .put('/api/auth')
    .send(adminUser);

  expect(adminLoginRes.status).toBe(200);
  adminAuthToken = adminLoginRes.body.token;
  expectValidJwt(adminAuthToken);
});

test('login', async () => {
  const loginRes = await request(app)
    .put('/api/auth')
    .send(testUser);

  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);

  const expectedUser = {
    ...testUser,
    roles: [{ role: 'diner' }],
  };

  delete expectedUser.password;
  expect(loginRes.body.user).toMatchObject(expectedUser);
});

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(
    /^[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*$/
  );
}

function randomName() {
   return Math.random().toString(36).substring(2, 12);
}

async function createAdminUser() {
  let user = {
    password: 'toomanysecrets',
    roles: [{ role: Role.Admin }],
  };

  user.name = randomName();
  user.email = `${user.name}@admin.com`;

  user = await DB.addUser(user);
  return { ...user, password: 'toomanysecrets' };
}

test('GET /api/user/me rejects a request without a token', async () => {
   const response = await request(app).get('/api/user/me');
 
   expect(response.status).toBe(401);
 });
 
 test('GET /api/user/me returns the logged-in user', async () => {
   const response = await request(app)
     .get('/api/user/me')
     .set('Authorization', `Bearer ${testUserAuthToken}`);
 
   expect(response.status).toBe(200);
   expect(response.body.email).toBe(testUser.email);
 });
 
 test('GET /api/order/menu returns the menu', async () => {
   const response = await request(app).get('/api/order/menu');
 
   expect(response.status).toBe(200);
   expect(Array.isArray(response.body)).toBe(true);
 });
 
 test('admin can add a menu item', async () => {
   const item = {
     title: `Test ${randomName()}`,
     description: 'Coverage test item',
     image: 'test.png',
     price: 0.01,
   };
 
   const response = await request(app)
     .put('/api/order/menu')
     .set('Authorization', `Bearer ${adminAuthToken}`)
     .send(item);
 
   expect(response.status).toBe(200);
   expect(response.body.some((menuItem) => menuItem.title === item.title)).toBe(true);
 });
 
 test('GET /api/order rejects a request without a token', async () => {
   const response = await request(app).get('/api/order');
 
   expect(response.status).toBe(401);
 });
 
 test('GET /api/franchise returns the franchise list', async () => {
   const response = await request(app).get('/api/franchise');
 
   expect(response.status).toBe(200);
   expect(Array.isArray(response.body.franchises)).toBe(true);
   expect(typeof response.body.more).toBe('boolean');
 });