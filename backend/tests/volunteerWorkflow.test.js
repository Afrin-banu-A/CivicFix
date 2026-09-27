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

    const volEmail = `testvol_${Date.now()}@example.com`;
    const vol2Email = `testvol2_${Date.now()}@example.com`;
    const citEmail = `testcit_${Date.now()}@example.com`;

    // Create volunteer 1 account (assigned volunteer role in DB)
    const res1 = await fetch(`${baseUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'Test Volunteer 1',
            email: volEmail,
            password: 'password123'
        })
    });
    const data1 = await res1.json();
    assert.strictEqual(res1.status, 201);
    volunteerToken = data1.data.token;
    volunteerUser = data1.data.user;
    await User.updateRole(volunteerUser.id, 'volunteer');
    volunteerUser.role = 'volunteer';

    // Create volunteer 2 account (assigned volunteer role in DB)
    const res2 = await fetch(`${baseUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'Test Volunteer 2',
            email: vol2Email,
            password: 'password123'
        })
    });
    const data2 = await res2.json();
    assert.strictEqual(res2.status, 201);
    volunteer2Token = data2.data.token;
    volunteer2User = data2.data.user;
    await User.updateRole(volunteer2User.id, 'volunteer');
    volunteer2User.role = 'volunteer';

    // Create citizen account
    const res3 = await fetch(`${baseUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'Test Citizen',
            email: citEmail,
            password: 'password123'
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
    const resCit = await fetch(`${baseUrl}/complaints`);
    const dataCit = await resCit.json();
    const citTarget = dataCit.data.find((c) => c.id === testComplaint.id);
    assert.strictEqual(citTarget.status, 'Resolved');

    const resVol2 = await fetch(`${baseUrl}/complaints`, {
        headers: { 'Authorization': `Bearer ${volunteer2Token}` }
    });
    const dataVol2 = await resVol2.json();
    const vol2Target = dataVol2.data.find((c) => c.id === testComplaint.id);
    assert.strictEqual(vol2Target.status, 'Resolved');
});

test('12. Security Audit — Signup self-promotion to volunteer is rejected', async () => {
    const attemptedEmail = `hacker_signup_${Date.now()}@example.com`;
    const res = await fetch(`${baseUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'Self Promoter',
            email: attemptedEmail,
            password: 'password123',
            role: 'volunteer'
        })
    });
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.strictEqual(data.data.user.role, 'citizen');

    const dbUser = await User.findByEmail(attemptedEmail);
    assert.strictEqual(dbUser.role, 'citizen');
});

test('13. Security Audit — Login self-promotion to volunteer is rejected', async () => {
    const citizenEmail = `citizen_login_${Date.now()}@example.com`;
    const resSignup = await fetch(`${baseUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'Ordinary Citizen',
            email: citizenEmail,
            password: 'password123'
        })
    });
    const signupData = await resSignup.json();
    assert.strictEqual(signupData.data.user.role, 'citizen');

    // Attempt login passing role: "volunteer"
    const resLogin = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: citizenEmail,
            password: 'password123',
            role: 'volunteer'
        })
    });
    assert.strictEqual(resLogin.status, 200);
    const loginData = await resLogin.json();
    const loginToken = loginData.data.token;

    // Verify user role returned by login remains citizen
    assert.strictEqual(loginData.data.user.role, 'citizen');

    // Verify database row remains citizen
    const dbUser = await User.findByEmail(citizenEmail);
    assert.strictEqual(dbUser.role, 'citizen');

    // Verify calling volunteer claim endpoint with this token returns 403 Forbidden
    const claimRes = await fetch(`${baseUrl}/complaints/${testComplaint.id}/claim`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${loginToken}`
        }
    });
    assert.strictEqual(claimRes.status, 403);
});
