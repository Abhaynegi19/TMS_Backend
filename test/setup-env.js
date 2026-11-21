// Imported first by every test file so config is in place before the app loads.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.NODE_ENV = 'test';
process.env.UPLOAD_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), 'tms-uploads-'));
delete process.env.SMTP_HOST;
delete process.env.REQUIRE_POD;
process.env.JWT_SECRET ||= 'test-secret-test-secret-test-secret';
process.env.CLIENT_ORIGIN ||= 'http://localhost:5173';
