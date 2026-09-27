const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../server');
const initDatabase = require('../src/config/initDatabase');
const pool = require('../src/config/database');
const Complaint = require('../src/models/Complaint');
const User = require('../src/models/User');

let server;
let baseUrl;

let volunteerToken;
let volunteerUser;
let volunteer2Token;
let volunteer2User;
let citizenToken;
let citizenUser;
let testComplaint;

before(async () => {
    await initDatabase();
    await new Promise((resolve) => {
        server = app.listen(0, () => {
            const port = server.address().port;
            baseUrl = `http://localhost:${port}/api`;
            resolve();
        });
    });

    // Clean up test data if existing
    const volEmail = `testvol_${Date.now()}@example.com`;
    const vol2Email = `testvol2_${Date.now()}@example.com`;
    const citEmail = `testcit_${Date.now()}@example.com`;

    // Create volunteer 1
    const res1 = await fetch(`${baseUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'Test Volunteer 1',
            email: volEmail,
            password: 'password123',
            role: 'volunteer'
        })
    });
    const data1 = await res1.json();
    assert.strictEqual(res1.status, 201);
    volunteerToken = data1.data.token;
    volunteerUser = data1.data.user;

    // Create volunteer 2
    const res2 = await fetch(`${baseUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'Test Volunteer 2',
            email: vol2Email,
            password: 'password123',
            role: 'volunteer'
        })
    });
    const data2 = await res2.json();
    assert.strictEqual(res2.status, 201);
    volunteer2Token = data2.data.token;
    volunteer2User = data2.data.user;

    // Create citizen
    const res3 = await fetch(`${baseUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'Test Citizen',
            email: citEmail,
            password: 'password123',
            role: 'citizen'
        })
    });
    const data3 = await res3.json();
    assert.strictEqual(res3.status, 201);
    citizenToken = data3.data.token;
    citizenUser = data3.data.user;
});

after(async () => {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
    setTimeout(() => process.exit(0), 100);
});

test('1. Unauthorized claim request should return 401', async () => {
    const res = await fetch(`${baseUrl}/complaints/1/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.success, false);
});

test('2. Authenticated non-volunteer claim request should return 403', async () => {
    // Create complaint
    const created = await Complaint.create({
        name: 'Reporter',
        phone: '1234567890',
        area: 'Anna Nagar',
        city: 'Chennai',
        issueType: 'Pothole',
        description: 'Test pothole',
        severity: 'medium'
    });

    const res = await fetch(`${baseUrl}/complaints/${created.id}/claim`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${citizenToken}`
        }
    });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.success, false);
});

test('3. Authorized volunteer claim should succeed', async () => {
    testComplaint = await Complaint.create({
        name: 'Reporter 2',
        phone: '1234567890',
        area: 'T Nagar',
        city: 'Chennai',
        issueType: 'Garbage',
        description: 'Test garbage',
        severity: 'medium'
    });

    const res = await fetch(`${baseUrl}/complaints/${testComplaint.id}/claim`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${volunteerToken}`
        }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.data.status, 'In Progress');
    assert.strictEqual(data.data.claimed_by_user_id, volunteerUser.id);
});

test('4. Duplicate/conflicting claim should be rejected by backend', async () => {
    // Volunteer 2 attempts to claim the same complaint already claimed by Volunteer 1
    const res = await fetch(`${baseUrl}/complaints/${testComplaint.id}/claim`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${volunteer2Token}`
        }
    });
    assert.strictEqual(res.status, 409);
    const data = await res.json();
    assert.strictEqual(data.success, false);
});

test('5. Invalid complaint state for claim should return 409', async () => {
    // Volunteer 1 attempts to claim again when status is already 'In Progress'
    const res = await fetch(`${baseUrl}/complaints/${testComplaint.id}/claim`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${volunteerToken}`
        }
    });
    assert.strictEqual(res.status, 409);
    const data = await res.json();
    assert.strictEqual(data.success, false);
});

test('6. Database persistence after claim', async () => {
    const fresh = await Complaint.findById(testComplaint.id);
    assert.strictEqual(fresh.status, 'In Progress');
    assert.strictEqual(fresh.claimed_by_user_id, volunteerUser.id);
    assert.strictEqual(fresh.claimed_by, volunteerUser.name);
});

test('7. Authorized volunteer resolution should succeed', async () => {
    const res = await fetch(`${baseUrl}/complaints/${testComplaint.id}/resolve`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${volunteerToken}`
        }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.data.status, 'Resolved');
    assert.strictEqual(data.data.resolved_by_user_id, volunteerUser.id);
});

test('8. Database persistence after resolution', async () => {
    const fresh = await Complaint.findById(testComplaint.id);
    assert.strictEqual(fresh.status, 'Resolved');
    assert.strictEqual(fresh.resolved_by_user_id, volunteerUser.id);
    assert.strictEqual(fresh.resolved_by, volunteerUser.name);
});

test('9. Invalid resolution state should return 400', async () => {
    // Complaint is now 'Resolved', resolving it again should fail
    const res = await fetch(`${baseUrl}/complaints/${testComplaint.id}/resolve`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${volunteerToken}`
        }
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.success, false);
});

test('10. Backend rejects manipulated client role', async () => {
    // Citizen user attempts to claim with a body parameter saying role=volunteer
    const res = await fetch(`${baseUrl}/complaints/${testComplaint.id}/claim`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${citizenToken}`
        },
        body: JSON.stringify({ userRole: 'volunteer', role: 'volunteer', claimedBy: 'Hacker' })
    });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.success, false);
});

test('11. Multiple users receive the same authoritative complaint state', async () => {
    // Fetch complaint list as citizen
    const resCit = await fetch(`${baseUrl}/complaints`);
    const dataCit = await resCit.json();
    const citTarget = dataCit.data.find((c) => c.id === testComplaint.id);
    assert.strictEqual(citTarget.status, 'Resolved');

    // Fetch complaint list as volunteer 2
    const resVol2 = await fetch(`${baseUrl}/complaints`, {
        headers: { 'Authorization': `Bearer ${volunteer2Token}` }
    });
    const dataVol2 = await resVol2.json();
    const vol2Target = dataVol2.data.find((c) => c.id === testComplaint.id);
    assert.strictEqual(vol2Target.status, 'Resolved');
});
