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