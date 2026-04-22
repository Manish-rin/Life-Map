require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb }        = require('./database');
const { runMigrations } = require('./migrate');

// ─── HELPERS ─────────────────────────────────────────────────
const now = () => Date.now();
const daysAgo = (d) => Date.now() - d * 86_400_000;

function runSeed() {
  runMigrations();
  const db = getDb();

  // ── Clear existing seed data ────────────────────────────────
  db.exec(`
    DELETE FROM trust_log;
    DELETE FROM badges;
    DELETE FROM donations;
    DELETE FROM request_responses;
    DELETE FROM escalation_events;
    DELETE FROM emergency_requests;
    DELETE FROM sessions;
    DELETE FROM blood_banks;
    DELETE FROM users;
  `);

  const pw = bcrypt.hashSync('praansetu123', 10);

  // ── 1. DEMO USER — Rohan Sharma  (matches frontend mock exactly) ──
  const ROHAN_ID = 'demo-rohan-sharma-001';
  db.prepare(`
    INSERT INTO users (id,name,phone,password_hash,blood_group,trust_score,tier,aadhaar_verified,is_available,lat,lng,city,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(ROHAN_ID,'Rohan Sharma','9876543210',pw,'O+',73,'individual',1,1,25.5941,85.1376,'Patna, Bihar',daysAgo(60));

  // ── 2. MORE DONORS ────────────────────────────────────────────
  const donors = [
    { name:'Priya Mehta',     phone:'9811001001', bg:'A+', score:55, city:'New Delhi',    lat:28.6139, lng:77.2090 },
    { name:'Arjun Das',       phone:'9822002002', bg:'B+', score:40, city:'Kolkata',      lat:22.5726, lng:88.3639 },
    { name:'Sunita Rao',      phone:'9833003003', bg:'O-', score:88, city:'Bangalore',    lat:12.9716, lng:77.5946 },
    { name:'Vikram Singh',    phone:'9844004004', bg:'AB+',score:62, city:'Mumbai',       lat:19.0760, lng:72.8777 },
    { name:'Deepa Nair',      phone:'9855005005', bg:'A-', score:31, city:'Chennai',      lat:13.0827, lng:80.2707 },
    { name:'Rahul Verma',     phone:'9866006006', bg:'B-', score:74, city:'Lucknow',     lat:26.8467, lng:80.9462 },
    { name:'Anjali Sharma',   phone:'9877007007', bg:'O+', score:91, city:'Hyderabad',   lat:17.3850, lng:78.4867 },
    { name:'Manish Kumar',    phone:'9888008008', bg:'AB-',score:20, city:'Ahmedabad',   lat:23.0225, lng:72.5714 },
    { name:'Kavya Pillai',    phone:'9899009009', bg:'A+', score:67, city:'Pune',        lat:18.5204, lng:73.8567 },
    { name:'Sameer Patel',    phone:'9800010010', bg:'B+', score:48, city:'Jaipur',      lat:26.9124, lng:75.7873 },
    { name:'Nisha Tiwari',    phone:'9811011011', bg:'O+', score:82, city:'Patna, Bihar', lat:25.6105, lng:85.1520 },
  ];

  const insertUser = db.prepare(`
    INSERT INTO users (id,name,phone,password_hash,blood_group,trust_score,tier,aadhaar_verified,is_available,lat,lng,city,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const donorIds = {};
  for (const d of donors) {
    const id = uuidv4();
    donorIds[d.phone] = id;
    insertUser.run(id, d.name, d.phone, pw, d.bg, d.score, 'individual', 1, 1, d.lat, d.lng, d.city, daysAgo(Math.floor(Math.random()*180)+10));
  }

  // ── 3. NGO USER ──────────────────────────────────────────────
  const NGO_ID = uuidv4();
  db.prepare(`
    INSERT INTO users (id,name,phone,password_hash,blood_group,trust_score,tier,aadhaar_verified,is_available,lat,lng,city)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(NGO_ID,'Bihar Blood Bank NGO','9900000001',pw,'O+',95,'ngo',1,1,25.5941,85.1376,'Patna, Bihar');

  // ── 4. BLOOD BANKS ────────────────────────────────────────────
  const insertBank = db.prepare(`
    INSERT INTO blood_banks (id,name,address,lat,lng,phone,stocks)
    VALUES (?,?,?,?,?,?,?)
  `);

  const banks = [
    {
      id: 'bank-aiims-patna',
      name: 'AIIMS Patna Blood Bank',
      address: 'AIIMS Patna, Phulwarisharif, Patna 801507',
      lat: 25.6037, lng: 85.0875, phone: '06122451070',
      stocks: { 'A+':true,'A-':false,'B+':true,'B-':false,'O+':true,'O-':false,'AB+':true,'AB-':false }
    },
    {
      id: 'bank-pmch-patna',
      name: 'PMCH Blood Bank',
      address: 'Patna Medical College & Hospital, Patna 800004',
      lat: 25.6200, lng: 85.1446, phone: '06122300300',
      stocks: { 'A+':true,'A-':true,'B+':true,'B-':false,'O+':false,'O-':false,'AB+':true,'AB-':false }
    },
    {
      id: 'bank-ruban-patna',
      name: 'Ruban Memorial Hospital',
      address: 'Bailey Road, Patna 800014',
      lat: 25.5966, lng: 85.0706, phone: '06122590000',
      stocks: { 'A+':false,'A-':false,'B+':true,'B-':false,'O+':true,'O-':false,'AB+':false,'AB-':false }
    },
    {
      id: 'bank-apollo-delhi',
      name: 'Apollo Delhi Blood Bank',
      address: 'Sarita Vihar, Delhi Mathura Road, New Delhi 110076',
      lat: 28.5665, lng: 77.2730, phone: '01126925858',
      stocks: { 'A+':true,'A-':true,'B+':true,'B-':true,'O+':true,'O-':true,'AB+':true,'AB-':true }
    },
    {
      id: 'bank-fortis-blr',
      name: 'Fortis Hospital Bangalore',
      address: '154/9 Bannerghatta Road, Bangalore 560076',
      lat: 12.9352, lng: 77.6245, phone: '08066214444',
      stocks: { 'A+':true,'A-':false,'B+':true,'B-':false,'O+':true,'O-':false,'AB+':false,'AB-':false }
    },
  ];

  for (const b of banks) {
    insertBank.run(b.id, b.name, b.address, b.lat, b.lng, b.phone, JSON.stringify(b.stocks));
  }

  // ── 5. DONATIONS for Rohan ────────────────────────────────────
  const insertDonation = db.prepare(`
    INSERT INTO donations (id,donor_id,request_id,hospital,status,donated_at,created_at)
    VALUES (?,?,?,?,?,?,?)
  `);

  const rohanDonations = [
    { hospital:'AIIMS Patna',           daysAgo_: 80  },
    { hospital:'Civil Hospital Patna',  daysAgo_: 350 },
    { hospital:'Medica North Bengal',   daysAgo_: 500 },
    { hospital:'AIIMS Patna',           daysAgo_: 190 },
    { hospital:'PMCH Patna',            daysAgo_: 700 },
    { hospital:'Apollo Delhi',          daysAgo_: 900 },
    { hospital:'Fortis Bangalore',      daysAgo_: 1100 },
  ];
  for (const d of rohanDonations) {
    const ts = daysAgo(d.daysAgo_);
    insertDonation.run(uuidv4(), ROHAN_ID, null, d.hospital, 'confirmed', ts, ts);
  }

  // ── 6. TRUST LOG for Rohan ────────────────────────────────────
  const insertLog = db.prepare(`
    INSERT INTO trust_log (id,user_id,delta,reason,created_at)
    VALUES (?,?,?,?,?)
  `);

  const trustEvents = [
    { delta: 5,  reason: 'Profile created · Aadhaar verified',         daysAgo_: 425 },
    { delta: 5,  reason: 'Donation confirmed · Fortis Bangalore',       daysAgo_: 1100 },
    { delta: 5,  reason: 'Donation confirmed · Apollo Delhi',           daysAgo_: 900 },
    { delta: 5,  reason: 'Donation confirmed · PMCH Patna',             daysAgo_: 700 },
    { delta:-3,  reason: 'Request declined — was unavailable',          daysAgo_: 595 },
    { delta: 5,  reason: 'Donation confirmed · Medica North Bengal',    daysAgo_: 500 },
    { delta: 2,  reason: 'Fast response badge · responded in 1m 42s',  daysAgo_: 500 },
    { delta: 5,  reason: 'Donation confirmed · AIIMS Patna',            daysAgo_: 350 },
    { delta: 5,  reason: 'Donation confirmed · Civil Hospital Patna',   daysAgo_: 190 },
    { delta: 2,  reason: 'Fast response badge · responded in 2m 10s',  daysAgo_: 190 },
    { delta: 5,  reason: 'Donation confirmed · AIIMS Patna',            daysAgo_: 80  },
    { delta: 2,  reason: 'Fast response badge · responded in 58s',      daysAgo_: 80  },
    { delta:-3,  reason: 'Request declined — prior commitment',          daysAgo_: 20  },
  ];
  for (const e of trustEvents) {
    insertLog.run(uuidv4(), ROHAN_ID, e.delta, e.reason, daysAgo(e.daysAgo_));
  }

  // ── 7. BADGES for Rohan ───────────────────────────────────────
  const insertBadge = db.prepare(`
    INSERT OR IGNORE INTO badges (id,user_id,badge_key,earned_at)
    VALUES (?,?,?,?)
  `);
  insertBadge.run(uuidv4(), ROHAN_ID, 'id_verified',    daysAgo(425));
  insertBadge.run(uuidv4(), ROHAN_ID, 'first_drop',     daysAgo(1100));
  insertBadge.run(uuidv4(), ROHAN_ID, 'first_responder',daysAgo(500));
  insertBadge.run(uuidv4(), ROHAN_ID, 'on_a_streak',    daysAgo(80));

  // ── 8. ACTIVE EMERGENCY REQUESTS ─────────────────────────────
  const insertReq = db.prepare(`
    INSERT INTO emergency_requests (id,requester_id,blood_group,hospital,hospital_ward,urgency,current_mode,status,lat,lng,city,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const REQ1_ID = 'req-demo-001';
  const REQ2_ID = 'req-demo-002';

  insertReq.run(
    REQ1_ID, NGO_ID, 'A+', 'AIIMS Patna', 'Ward B', 'Critical', 1, 'active',
    25.6037, 85.0875, 'Patna, Bihar', daysAgo(0.01), daysAgo(-1)
  );
  insertReq.run(
    REQ2_ID, null, 'O-', 'PMCH Patna', 'ICU', 'Urgent', 1, 'active',
    25.6200, 85.1446, 'Patna, Bihar', daysAgo(0.05), daysAgo(-0.5)
  );

  console.log('✅  Seed complete:');
  console.log('    · 13 donors (incl. demo user Rohan Sharma)');
  console.log('    · 5 blood banks');
  console.log('    · 7 completed donations for Rohan');
  console.log('    · 2 active emergency requests');
  console.log('\n🔑  Demo login:  phone=9876543210  otp=123456');
}

// Allow running directly: node src/db/seed.js
if (require.main === module) {
  runSeed();
}

module.exports = { runSeed };
