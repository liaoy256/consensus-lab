const { chromium } = require('C:/Users/33758/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

let browser;

(async () => {
  browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
  });
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const guestContext = await browser.newContext({
    viewport: { width: 430, height: 860 },
    isMobile: true,
    hasTouch: true,
  });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const errors = [];
  for (const [label, page] of [['host', host], ['guest', guest]]) {
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`${label}: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`${label}: ${error.message}`));
    page.on('requestfailed', (request) => {
      if (request.url().startsWith('ws')) errors.push(`${label} request: ${request.failure()?.errorText}`);
    });
    page.on('websocket', (socket) => {
      socket.on('socketerror', (error) => errors.push(`${label} websocket: ${error}`));
    });
  }

  await host.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await host.locator('#playerName').fill('老师');
  await host.locator('#createRoomButton').click();
  await host.locator('#gamePanel').waitFor({ state: 'visible' });
  await host.waitForTimeout(15000);
  const room = (await host.locator('#roomCode').innerText()).trim();
  const initialStatus = await host.locator('#roomStatus').innerText();
  if (!initialStatus.includes('房间已上线')) {
    console.log(JSON.stringify({ initialStatus, errors }, null, 2));
    await browser.close();
    process.exitCode = 1;
    return;
  }

  await guest.goto(`http://127.0.0.1:4173/?room=${room}`, { waitUntil: 'networkidle' });
  await guest.locator('#playerName').fill('学生甲');
  await guest.locator('#joinRoomButton').click();
  await guest.locator('#gamePanel').waitFor({ state: 'visible', timeout: 25000 });
  await host.waitForFunction(
    () => document.querySelector('#nodeCount')?.innerText.includes('2'),
    null,
    { timeout: 15000 },
  );

  await guest.locator('#transferAmount').fill('6');
  await guest.locator('#sendTransferButton').click();
  await host.waitForFunction(
    () => document.querySelectorAll('#mempoolList .pool-item').length === 1,
    null,
    { timeout: 15000 },
  );
  await guest.waitForFunction(
    () => document.querySelectorAll('#mempoolList .pool-item').length === 1,
    null,
    { timeout: 15000 },
  );

  await host.locator('#mineButton').click();
  await host.waitForFunction(
    () => document.querySelector('#chainHeight')?.innerText === '1',
    null,
    { timeout: 30000 },
  );
  await guest.waitForFunction(
    () => document.querySelector('#chainHeight')?.innerText === '1',
    null,
    { timeout: 15000 },
  );

  const result = {
    room,
    hostNodes: await host.locator('#nodeCount').innerText(),
    guestNodes: await guest.locator('#nodeCount').innerText(),
    hostHeight: await host.locator('#chainHeight').innerText(),
    guestHeight: await guest.locator('#chainHeight').innerText(),
    guestLedgerStatus: await guest.locator('#ledgerTable td:nth-child(5) span').first().innerText(),
    errors,
  };
  await host.screenshot({ path: 'C:/Users/33758/Desktop/区块链/_qa-room-host.png', fullPage: true });
  await guest.screenshot({ path: 'C:/Users/33758/Desktop/区块链/_qa-room-guest.png', fullPage: true });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
  if (errors.length) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  browser?.close().catch(() => {});
  process.exitCode = 1;
});
