const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database.js');

if (process.env.VSCODE_INSPECTOR_OPTIONS) {
  jest.setTimeout(60 * 1000 * 5); // 5 minutes while debugging
}

let testUser;
let testUserId;
let testUserAuthToken;

let adminUser;
let adminAuthToken;

let menuItemId;
let franchiseId;
let secondFranchiseId;
let storeId;

beforeAll(async () => {
  testUser = {
    name: `Diner ${randomName()}`,
    email: `${randomName()}@test.com`,
    password: 'a',
  };

  const registerRes = await request(app)
    .post('/api/auth')
    .send(testUser);

  expect(registerRes.status).toBe(200);

  testUserId = registerRes.body.user.id;
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

/* ------------------------------------------------------------------
   service.js
------------------------------------------------------------------ */

test('GET / returns the welcome message', async () => {
  const response = await request(app).get('/');

  expect(response.status).toBe(200);
  expect(response.body.message).toBe('welcome to JWT Pizza');
  expect(response.body.version).toBeDefined();
});

test('GET /api/docs returns the API documentation', async () => {
  const response = await request(app).get('/api/docs');

  expect(response.status).toBe(200);
  expect(Array.isArray(response.body.endpoints)).toBe(true);
  expect(response.body.config).toBeDefined();
});

test('an unknown endpoint returns 404', async () => {
  const response = await request(app).get('/unknown-endpoint');

  expect(response.status).toBe(404);
  expect(response.body.message).toBe('unknown endpoint');
});

/* ------------------------------------------------------------------
   authRouter.js
------------------------------------------------------------------ */

test('registration requires a name, email, and password', async () => {
  const response = await request(app)
    .post('/api/auth')
    .send({
      email: `${randomName()}@test.com`,
    });

  expect(response.status).toBe(400);
  expect(response.body.message).toBe(
    'name, email, and password are required'
  );
});

test('login returns the expected user and JWT', async () => {
  const response = await request(app)
    .put('/api/auth')
    .send(testUser);

  expect(response.status).toBe(200);
  expectValidJwt(response.body.token);

  const expectedUser = {
    name: testUser.name,
    email: testUser.email,
    roles: [{ role: Role.Diner }],
  };

  expect(response.body.user).toMatchObject(expectedUser);
});

test('login rejects an incorrect password', async () => {
  const response = await request(app)
    .put('/api/auth')
    .send({
      email: testUser.email,
      password: 'incorrect-password',
    });

  expect(response.status).toBe(404);
  expect(response.body.message).toBe('unknown user');
});

test('a protected endpoint rejects an invalid token', async () => {
  await DB.loginUser(testUserId, 'bad.header.signature');

  const response = await request(app)
    .get('/api/user/me')
    .set('Authorization', 'Bearer bad.header.signature');

  expect(response.status).toBe(401);
});

test('logout requires authentication', async () => {
  const response = await request(app).delete('/api/auth');

  expect(response.status).toBe(401);
});

/* ------------------------------------------------------------------
   userRouter.js
------------------------------------------------------------------ */

test('GET /api/user/me requires authentication', async () => {
  const response = await request(app).get('/api/user/me');

  expect(response.status).toBe(401);
});

test('GET /api/user/me returns the authenticated user', async () => {
  const response = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${testUserAuthToken}`);

  expect(response.status).toBe(200);
  expect(response.body.id).toBe(testUserId);
  expect(response.body.email).toBe(testUser.email);
});

test('a diner cannot update another user', async () => {
  const response = await request(app)
    .put(`/api/user/${adminUser.id}`)
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send({
      name: 'Unauthorized change',
      email: adminUser.email,
      password: 'new-password',
    });

  expect(response.status).toBe(403);
  expect(response.body.message).toBe('unauthorized');
});

test('a diner can update their own account', async () => {
  const updatedUser = {
    name: `Updated ${randomName()}`,
    email: `${randomName()}@updated.com`,
    password: 'updated-password',
  };

  const response = await request(app)
    .put(`/api/user/${testUserId}`)
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send(updatedUser);

  expect(response.status).toBe(200);
  expect(response.body.user.name).toBe(updatedUser.name);
  expect(response.body.user.email).toBe(updatedUser.email);
  expectValidJwt(response.body.token);

  testUser = updatedUser;
  testUserAuthToken = response.body.token;
});

test('GET /api/user returns the placeholder user list', async () => {
  const response = await request(app)
    .get('/api/user')
    .set('Authorization', `Bearer ${testUserAuthToken}`);

  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    message: 'not implemented',
    users: [],
    more: false,
  });
});

test('DELETE /api/user/:userId returns not implemented', async () => {
  const response = await request(app)
    .delete(`/api/user/${testUserId}`)
    .set('Authorization', `Bearer ${testUserAuthToken}`);

  expect(response.status).toBe(200);
  expect(response.body.message).toBe('not implemented');
});

/* ------------------------------------------------------------------
   orderRouter.js
------------------------------------------------------------------ */

test('GET /api/order/menu returns an array', async () => {
  const response = await request(app).get('/api/order/menu');

  expect(response.status).toBe(200);
  expect(Array.isArray(response.body)).toBe(true);
});

test('a diner cannot add a menu item', async () => {
  const response = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send({
      title: `Denied ${randomName()}`,
      description: 'This should not be added',
      image: 'denied.png',
      price: 0.01,
    });

  expect(response.status).toBe(403);
  expect(response.body.message).toBe('unable to add menu item');
});

test('an admin can add a menu item', async () => {
  const menuItem = {
    title: `Pizza ${randomName()}`,
    description: 'Coverage test pizza',
    image: 'coverage.png',
    price: 0.01,
  };

  const response = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send(menuItem);

  expect(response.status).toBe(200);

  const savedItem = response.body.find(
    (item) => item.title === menuItem.title
  );

  expect(savedItem).toBeDefined();
  menuItemId = savedItem.id;
});

test('GET /api/order requires authentication', async () => {
  const response = await request(app).get('/api/order');

  expect(response.status).toBe(401);
});

test('an authenticated diner can get their orders', async () => {
  const response = await request(app)
    .get('/api/order')
    .set('Authorization', `Bearer ${testUserAuthToken}`);

  expect(response.status).toBe(200);
  expect(response.body.dinerId).toBe(testUserId);
  expect(Array.isArray(response.body.orders)).toBe(true);
});

/* ------------------------------------------------------------------
   franchiseRouter.js
------------------------------------------------------------------ */

test('GET /api/franchise returns the public franchise list', async () => {
  const response = await request(app).get('/api/franchise');

  expect(response.status).toBe(200);
  expect(Array.isArray(response.body.franchises)).toBe(true);
  expect(typeof response.body.more).toBe('boolean');
});

test('a diner cannot create a franchise', async () => {
  const response = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send({
      name: `Denied ${randomName()}`,
      admins: [{ email: adminUser.email }],
    });

  expect(response.status).toBe(403);
  expect(response.body.message).toBe('unable to create a franchise');
});

test('creating a franchise with an unknown admin fails', async () => {
  const response = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({
      name: `Invalid ${randomName()}`,
      admins: [{ email: `${randomName()}@missing.com` }],
    });

  expect(response.status).toBe(404);
});

test('an admin can create a franchise', async () => {
  const response = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({
      name: `Franchise ${randomName()}`,
      admins: [{ email: adminUser.email }],
    });

  expect(response.status).toBe(200);
  expect(response.body.id).toBeDefined();

  franchiseId = response.body.id;
});

test('an admin can create a second franchise', async () => {
  const response = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({
      name: `Franchise ${randomName()}`,
      admins: [{ email: adminUser.email }],
    });

  expect(response.status).toBe(200);
  secondFranchiseId = response.body.id;
});

test('franchise pagination reports when more results exist', async () => {
  const response = await request(app)
    .get('/api/franchise?page=0&limit=1&name=*')
    .set('Authorization', `Bearer ${adminAuthToken}`);

  expect(response.status).toBe(200);
  expect(response.body.franchises).toHaveLength(1);
  expect(response.body.more).toBe(true);
});

test('a diner can request their empty franchise list', async () => {
  const response = await request(app)
    .get(`/api/franchise/${testUserId}`)
    .set('Authorization', `Bearer ${testUserAuthToken}`);

  expect(response.status).toBe(200);
  expect(response.body).toEqual([]);
});

test('an admin can request their franchises', async () => {
  const response = await request(app)
    .get(`/api/franchise/${adminUser.id}`)
    .set('Authorization', `Bearer ${adminAuthToken}`);

  expect(response.status).toBe(200);
  expect(Array.isArray(response.body)).toBe(true);
  expect(response.body.length).toBeGreaterThan(0);
});

test('an admin can create a store', async () => {
  const response = await request(app)
    .post(`/api/franchise/${franchiseId}/store`)
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({
      name: `Store ${randomName()}`,
    });

  expect(response.status).toBe(200);
  expect(response.body.id).toBeDefined();

  storeId = response.body.id;
});

test('a diner cannot create a store', async () => {
  const response = await request(app)
    .post(`/api/franchise/${franchiseId}/store`)
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send({
      name: `Denied store ${randomName()}`,
    });

  expect(response.status).toBe(403);
  expect(response.body.message).toBe('unable to create a store');
});

/* ------------------------------------------------------------------
   Order creation
------------------------------------------------------------------ */

test('a diner can create an order', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      reportUrl: 'https://example.test/report',
      jwt: 'factory-jwt',
    }),
  });

  try {
    const response = await request(app)
      .post('/api/order')
      .set('Authorization', `Bearer ${testUserAuthToken}`)
      .send({
        franchiseId,
        storeId,
        items: [
          {
            menuId: menuItemId,
            description: 'Coverage pizza',
            price: 0.01,
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.order.id).toBeDefined();
    expect(response.body.jwt).toBe('factory-jwt');
  } finally {
    fetchMock.mockRestore();
  }
});

test('GET /api/order returns the diner order and its items', async () => {
  const response = await request(app)
    .get('/api/order')
    .set('Authorization', `Bearer ${testUserAuthToken}`);

  expect(response.status).toBe(200);
  expect(response.body.orders.length).toBeGreaterThan(0);
  expect(Array.isArray(response.body.orders[0].items)).toBe(true);
});

test('the service handles a pizza factory failure', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: false,
    json: async () => ({
      reportUrl: 'https://example.test/failed-report',
    }),
  });

  try {
    const response = await request(app)
      .post('/api/order')
      .set('Authorization', `Bearer ${testUserAuthToken}`)
      .send({
        franchiseId,
        storeId,
        items: [],
      });

    expect(response.status).toBe(500);
    expect(response.body.message).toBe(
      'Failed to fulfill order at factory'
    );
  } finally {
    fetchMock.mockRestore();
  }
});

test('an order with an unknown menu ID fails', async () => {
  const response = await request(app)
    .post('/api/order')
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send({
      franchiseId,
      storeId,
      items: [
        {
          menuId: 999999999,
          description: 'Missing item',
          price: 0.01,
        },
      ],
    });

  expect(response.status).toBe(500);
});

/* ------------------------------------------------------------------
   Cleanup and small database helpers
------------------------------------------------------------------ */

test('database helper methods return the expected values', () => {
  expect(DB.getOffset(3, 10)).toBe(20);
  expect(DB.getTokenSignature('header.payload.signature')).toBe('signature');
  expect(DB.getTokenSignature('invalid-token')).toBe('');
});

test('an admin can delete a store', async () => {
  const response = await request(app)
    .delete(`/api/franchise/${franchiseId}/store/${storeId}`)
    .set('Authorization', `Bearer ${adminAuthToken}`);

  expect(response.status).toBe(200);
  expect(response.body.message).toBe('store deleted');
});

test('a franchise can be deleted', async () => {
  const firstResponse = await request(app)
    .delete(`/api/franchise/${franchiseId}`)
    .set('Authorization', `Bearer ${adminAuthToken}`);

  expect(firstResponse.status).toBe(200);

  const secondResponse = await request(app)
    .delete(`/api/franchise/${secondFranchiseId}`)
    .set('Authorization', `Bearer ${adminAuthToken}`);

  expect(secondResponse.status).toBe(200);
});

test('an authenticated user can log out', async () => {
  const response = await request(app)
    .delete('/api/auth')
    .set('Authorization', `Bearer ${testUserAuthToken}`);

  expect(response.status).toBe(200);
  expect(response.body.message).toBe('logout successful');

  const afterLogout = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${testUserAuthToken}`);

  expect(afterLogout.status).toBe(401);
});

/* ------------------------------------------------------------------
   Helpers from the course instructions
------------------------------------------------------------------ */

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