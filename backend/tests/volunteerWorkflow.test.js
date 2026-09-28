const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../server');
const initDatabase = require('../src/config/initDatabase');
const Complaint = require('../src/models/Complaint');
const User = require('../src/models/User');
const VolunteerRequest = require('../src/models/VolunteerRequest');

let server;
let baseUrl;

let adminToken;
let adminUser;
let volunteerToken;
let volunteerUser;
let volunteer2Token;
let volunteer2User;
let citizenToken;
let citizenUser;
let testComplaint;

before(async () => {
    const timestamp = Date.now();
    const adminEmail = `admin_${timestamp}@example.com`;
    const volEmail = `testvol_${timestamp}@example.com`;
    const vol2Email = `testvol2_${timestamp}@example.com`;
    const citEmail = `testcit_${timestamp}@example.com`;

    // Set up designated admin env vars for test environment
    process.env.admin_name = 'Test Admin';
    process.env.admin_email = adminEmail;
    process.env.admin_pass = 'adminpass123';

    await initDatabase();
    await new Promise((resolve) => {
        server = app.listen(0, () => {
            const port = server.address().port;
            baseUrl = `http://localhost:${port}/api`;
            resolve();
        });
    });

    // 1. Create Admin Account via API
    const adminRes = await fetch(`${baseUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: process.env.admin_name,
            email: adminEmail,
            password: process.env.admin_pass
        })
    });
    const adminData = await adminRes.json();
    assert.strictEqual(adminRes.status, 201);
    adminToken = adminData.data.token;
    adminUser = adminData.data.user;
    assert.strictEqual(adminUser.role, 'admin');

    // 2. Create Volunteer 1 account via real workflow (Signup -> Request -> Admin Approve -> Login)
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
    assert.strictEqual(data1.data.user.role, 'citizen');
    const tempVol1Token = data1.data.token;

    const req1Res = await fetch(`${baseUrl}/volunteers/request`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tempVol1Token}`
        }
    });
    const req1Data = await req1Res.json();
    assert.strictEqual(req1Res.status, 201);

    const app1Res = await fetch(`${baseUrl}/volunteers/${req1Data.data.request.id}/approve`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        }
    });
    assert.strictEqual(app1Res.status, 200);

    // Fresh login after approval to get updated token
    const login1Res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: volEmail, password: 'password123' })
    });
    const login1Data = await login1Res.json();
    assert.strictEqual(login1Res.status, 200);
    assert.strictEqual(login1Data.data.user.role, 'volunteer');
    volunteerToken = login1Data.data.token;
    volunteerUser = login1Data.data.user;

    // 3. Create Volunteer 2 account via real workflow (Signup -> Request -> Admin Approve -> Login)
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
    const tempVol2Token = data2.data.token;

    const req2Res = await fetch(`${baseUrl}/volunteers/request`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${tempVol2Token}`
        }
    });
    const req2Data = await req2Res.json();
    assert.strictEqual(req2Res.status, 201);

    const app2Res = await fetch(`${baseUrl}/volunteers/${req2Data.data.request.id}/approve`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        }
    });
    assert.strictEqual(app2Res.status, 200);

    const login2Res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: vol2Email, password: 'password123' })
    });
    const login2Data = await login2Res.json();
    assert.strictEqual(login2Res.status, 200);
    assert.strictEqual(login2Data.data.user.role, 'volunteer');
    volunteer2Token = login2Data.data.token;
    volunteer2User = login2Data.data.user;

    // 4. Create Citizen account
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
    assert.strictEqual(citizenUser.role, 'citizen');
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

    assert.strictEqual(loginData.data.user.role, 'citizen');
    const dbUser = await User.findByEmail(citizenEmail);
    assert.strictEqual(dbUser.role, 'citizen');

    const claimRes = await fetch(`${baseUrl}/complaints/${testComplaint.id}/claim`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${loginToken}`
        }
    });
    assert.strictEqual(claimRes.status, 403);
});

// NEW TESTS: VOLUNTEER ENROLLMENT & APPROVAL WORKFLOW

test('14. Volunteer Enrollment — Unauthenticated request is rejected (401)', async () => {
    const res = await fetch(`${baseUrl}/volunteers/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.success, false);
});

test('15. Volunteer Enrollment — Duplicate pending request is rejected (409)', async () => {
    const applicantEmail = `duplicatetest_${Date.now()}@example.com`;
    const signupRes = await fetch(`${baseUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'Duplicate Applicant',
            email: applicantEmail,
            password: 'password123'
        })
    });
    const signupData = await signupRes.json();
    const userToken = signupData.data.token;

    // First request should succeed (201)
    const req1 = await fetch(`${baseUrl}/volunteers/request`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userToken}`
        }
    });
    assert.strictEqual(req1.status, 201);
    const req1Data = await req1.json();
    assert.strictEqual(req1Data.data.request.status, 'pending');

    // Second request while first is pending should fail (409)
    const req2 = await fetch(`${baseUrl}/volunteers/request`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userToken}`
        }
    });
    assert.strictEqual(req2.status, 409);
    const req2Data = await req2.json();
    assert.strictEqual(req2Data.success, false);
});

test('16. Volunteer Enrollment — Already approved volunteer requesting access returns 400', async () => {
    const res = await fetch(`${baseUrl}/volunteers/request`, {
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

test('17. Volunteer Enrollment — Non-admin approving request returns 403', async () => {
    const applicantEmail = `nonadmintest_${Date.now()}@example.com`;
    const signupRes = await fetch(`${baseUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'NonAdmin Applicant',
            email: applicantEmail,
            password: 'password123'
        })
    });
    const signupData = await signupRes.json();
    const userToken = signupData.data.token;

    const reqRes = await fetch(`${baseUrl}/volunteers/request`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userToken}`
        }
    });
    const reqData = await reqRes.json();
    const requestId = reqData.data.request.id;

    // Attempt approve using citizen token
    const appRes = await fetch(`${baseUrl}/volunteers/${requestId}/approve`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${citizenToken}`
        }
    });
    assert.strictEqual(appRes.status, 403);

    // Attempt approve using volunteer token
    const appVolRes = await fetch(`${baseUrl}/volunteers/${requestId}/approve`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${volunteerToken}`
        }
    });
    assert.strictEqual(appVolRes.status, 403);
});

test('18. Volunteer Enrollment — Admin rejecting request leaves user as citizen', async () => {
    const rejectEmail = `rejecttest_${Date.now()}@example.com`;
    const signupRes = await fetch(`${baseUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'Reject Candidate',
            email: rejectEmail,
            password: 'password123'
        })
    });
    const signupData = await signupRes.json();
    const userToken = signupData.data.token;
    const userId = signupData.data.user.id;

    const reqRes = await fetch(`${baseUrl}/volunteers/request`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userToken}`
        }
    });
    const reqData = await reqRes.json();
    const requestId = reqData.data.request.id;

    // Admin rejects request
    const rejectRes = await fetch(`${baseUrl}/volunteers/${requestId}/reject`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        }
    });
    assert.strictEqual(rejectRes.status, 200);
    const rejectData = await rejectRes.json();
    assert.strictEqual(rejectData.data.request.status, 'rejected');

    // User in DB should remain citizen
    const dbUser = await User.findById(userId);
    assert.strictEqual(dbUser.role, 'citizen');

    // Attempting to claim complaint should return 403
    const claimRes = await fetch(`${baseUrl}/complaints/${testComplaint.id}/claim`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userToken}`
        }
    });
    assert.strictEqual(claimRes.status, 403);
});

test('19. End-to-End Real World Volunteer Enrollment & Complaint Management Workflow', async () => {
    const e2eEmail = `e2e_volunteer_${Date.now()}@example.com`;

    // Step 1: Register user
    const signupRes = await fetch(`${baseUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: 'E2E Volunteer Candidate',
            email: e2eEmail,
            password: 'password123'
        })
    });
    assert.strictEqual(signupRes.status, 201);
    const signupData = await signupRes.json();

    // Step 2: Verify backend assigns citizen role
    assert.strictEqual(signupData.data.user.role, 'citizen');
    let candidateToken = signupData.data.token;
    const candidateUserId = signupData.data.user.id;

    const dbUserInitial = await User.findById(candidateUserId);
    assert.strictEqual(dbUserInitial.role, 'citizen');

    // Step 3: Login user
    const loginInitialRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e2eEmail, password: 'password123' })
    });
    assert.strictEqual(loginInitialRes.status, 200);
    const loginInitialData = await loginInitialRes.json();
    assert.strictEqual(loginInitialData.data.user.role, 'citizen');
    candidateToken = loginInitialData.data.token;

    // Step 4: Submit volunteer request
    const requestRes = await fetch(`${baseUrl}/volunteers/request`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${candidateToken}`
        }
    });
    assert.strictEqual(requestRes.status, 201);
    const requestData = await requestRes.json();
    const requestId = requestData.data.request.id;

    // Step 5: Verify request is pending
    assert.strictEqual(requestData.data.request.status, 'pending');
    const pendingReqInDb = await VolunteerRequest.findById(requestId);
    assert.strictEqual(pendingReqInDb.status, 'pending');

    // Step 6: Create test complaint and attempt to claim as citizen
    const e2eComplaint = await Complaint.create({
        name: 'E2E Reporter',
        phone: '9876543210',
        area: 'Velachery',
        city: 'Chennai',
        issueType: 'Water Leak',
        description: 'E2E pipeline leak',
        severity: 'low'
    });

    // Step 7: Verify citizen receives 403 when claiming
    const claimForbiddenRes = await fetch(`${baseUrl}/complaints/${e2eComplaint.id}/claim`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${candidateToken}`
        }
    });
    assert.strictEqual(claimForbiddenRes.status, 403);

    // Step 8: Admin views pending volunteer requests
    const pendingListRes = await fetch(`${baseUrl}/volunteers/pending`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(pendingListRes.status, 200);
    const pendingListData = await pendingListRes.json();
    const foundInPending = pendingListData.data.find((r) => r.id === requestId);
    assert.ok(foundInPending, 'Pending request should be present in admin pending list');
    assert.strictEqual(foundInPending.user_email, e2eEmail);

    // Step 9: Admin approves request
    const approveRes = await fetch(`${baseUrl}/volunteers/${requestId}/approve`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${adminToken}`
        }
    });
    assert.strictEqual(approveRes.status, 200);
    const approveData = await approveRes.json();
    assert.strictEqual(approveData.data.request.status, 'approved');

    // Step 10: Verify user's role in DB becomes volunteer
    const dbUserApproved = await User.findById(candidateUserId);
    assert.strictEqual(dbUserApproved.role, 'volunteer');

    // Step 11: Login as volunteer again / obtain updated authentication
    const freshLoginRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e2eEmail, password: 'password123' })
    });
    assert.strictEqual(freshLoginRes.status, 200);
    const freshLoginData = await freshLoginRes.json();
    assert.strictEqual(freshLoginData.data.user.role, 'volunteer');
    const freshVolunteerToken = freshLoginData.data.token;

    // Step 12: Volunteer claims complaint
    const claimSuccessRes = await fetch(`${baseUrl}/complaints/${e2eComplaint.id}/claim`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${freshVolunteerToken}`
        }
    });
    assert.strictEqual(claimSuccessRes.status, 200);
    const claimSuccessData = await claimSuccessRes.json();
    assert.strictEqual(claimSuccessData.data.status, 'In Progress');
    assert.strictEqual(claimSuccessData.data.claimed_by_user_id, candidateUserId);

    // Step 13: Verify claim is persisted in database
    const dbComplaintClaimed = await Complaint.findById(e2eComplaint.id);
    assert.strictEqual(dbComplaintClaimed.status, 'In Progress');
    assert.strictEqual(dbComplaintClaimed.claimed_by_user_id, candidateUserId);

    // Step 14: Volunteer resolves complaint
    const resolveSuccessRes = await fetch(`${baseUrl}/complaints/${e2eComplaint.id}/resolve`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${freshVolunteerToken}`
        }
    });
    assert.strictEqual(resolveSuccessRes.status, 200);
    const resolveSuccessData = await resolveSuccessRes.json();
    assert.strictEqual(resolveSuccessData.data.status, 'Resolved');
    assert.strictEqual(resolveSuccessData.data.resolved_by_user_id, candidateUserId);

    // Step 15: Verify resolution is persisted in database
    const dbComplaintResolved = await Complaint.findById(e2eComplaint.id);
    assert.strictEqual(dbComplaintResolved.status, 'Resolved');
    assert.strictEqual(dbComplaintResolved.resolved_by_user_id, candidateUserId);

    // Step 16: Verify another volunteer cannot conflictingly claim the same complaint
    const conflictingClaimRes = await fetch(`${baseUrl}/complaints/${e2eComplaint.id}/claim`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${volunteerToken}`
        }
    });
    assert.strictEqual(conflictingClaimRes.status, 409);

    // Step 17: Reload complaint from database and verify final state remains correct
    const finalComplaintState = await Complaint.findById(e2eComplaint.id);
    assert.strictEqual(finalComplaintState.status, 'Resolved');
    assert.strictEqual(finalComplaintState.claimed_by_user_id, candidateUserId);
    assert.strictEqual(finalComplaintState.resolved_by_user_id, candidateUserId);
});
