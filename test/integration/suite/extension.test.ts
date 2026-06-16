import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'conclave.conclave';

describe('conclave extension', () => {
  it('is present and activates', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} not found`);
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true, 'extension did not activate');
  });

  it('registers the conclave.openPanel command', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('conclave.openPanel'),
      'conclave.openPanel command was not registered',
    );
  });

  it('executes conclave.openPanel without throwing', async () => {
    await vscode.commands.executeCommand('conclave.openPanel');
  });
});
