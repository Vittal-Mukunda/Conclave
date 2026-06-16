import * as path from 'path';
import { runTests } from '@vscode/test-electron';

// Downloads a VS Code build and runs the integration suite inside the real
// extension host. Run with: npm run test:integration (after pretest compile).
async function main(): Promise<void> {
  try {
    // out/test/integration -> repo root
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    await runTests({ extensionDevelopmentPath, extensionTestsPath });
  } catch (err) {
    console.error('Failed to run integration tests:', err);
    process.exit(1);
  }
}

void main();
