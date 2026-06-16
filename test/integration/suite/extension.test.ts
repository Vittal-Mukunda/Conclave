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

  it('registers the Phase 1 resilience commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('conclave.reportIssue'), 'reportIssue not registered');
    assert.ok(commands.includes('conclave.checkConnectivity'), 'checkConnectivity not registered');
    assert.ok(commands.includes('conclave.manageKeys'), 'manageKeys not registered');
  });

  it('checkConnectivity executes without throwing', async () => {
    await vscode.commands.executeCommand('conclave.checkConnectivity');
  });

  it('registers the Phase 5/6 commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('conclave.setBudget'), 'setBudget not registered');
    assert.ok(commands.includes('conclave.startOnboarding'), 'startOnboarding not registered');
    assert.ok(commands.includes('conclave.initGit'), 'initGit not registered');
  });

  it('registers the Phase 7 localize command', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('conclave.localize'), 'localize not registered');
  });

  it('registers the Phase 8 editing commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('conclave.checkpoint'), 'checkpoint not registered');
    assert.ok(
      commands.includes('conclave.rememberTestCommand'),
      'rememberTestCommand not registered',
    );
  });

  it('registers the Phase 9 verify command', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('conclave.verify'), 'verify not registered');
  });

  it('registers the Phase 10 agent command', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('conclave.runAgent'), 'runAgent not registered');
  });

  it('registers the Phase 11 difficulty command', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('conclave.estimateDifficulty'),
      'estimateDifficulty not registered',
    );
  });

  it('registers the Phase 12 feedback command', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('conclave.recordFeedback'), 'recordFeedback not registered');
  });
});
