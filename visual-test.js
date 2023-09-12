const { execSync, spawn } = require('child_process');

let subprocess;

async function runTests() {
  const buildCommand = 'npm run build:test';
  const testCommand = 'npm run test';

  console.log('Preparing test build');
  execSync(buildCommand);
  console.log('Test build ready');

  console.log('Starting test server');
  subprocess = spawn('node', ['./dist/index.js'], {
    stdio: [process.stdout, process.stdout, process.stdout],
    detached: true,
  });

  execSync(testCommand);
}

try {
  runTests();
} catch (error) {
  console.error(error.message);
  subprocess.kill();
  process.exit(1);
} finally {
  subprocess.kill();
  process.exit(0);
}
