'use strict';

const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const MQTT_BROKER = 'wss://broker.emqx.io:8084/mqtt';
const MQTT_TOPIC_PREFIX = 'consensus-lab-2026';
const INITIAL_BALANCE = 100;
const BLOCK_REWARD = 8;
const DIFFICULTY = 3;
const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

const app = {
  room: '',
  role: null,
  offline: false,
  identity: null,
  state: null,
  sync: null,
  mining: false,
  hostQueue: Promise.resolve(),
  waitingForSnapshot: false,
  snapshotWaiter: null,
  toastTimer: null,
  incidentBusy: false,
};

const ui = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheUi();
  bindEvents();
  configureIncomingRoom();
  const restored = await restoreSession();
  if (!restored) renderStaticDefaults();
}

function cacheUi() {
  const ids = [
    'entryPanel', 'entryForm', 'entryHint', 'entryMessage', 'playerName', 'roomJoinField',
    'roomCodeInput', 'createActions', 'joinActions', 'createRoomButton', 'joinRoomButton',
    'offlineDemoButton', 'cancelJoinButton', 'gamePanel', 'roomCodeButton', 'roomCode',
    'roomStatus', 'nodeCount', 'qrButton', 'presentButton', 'playerAvatar', 'playerRole',
    'playerDisplayName', 'playerBalance', 'playerAddress', 'playerConfirmed', 'playerPending',
    'showIdentityButton', 'chainHeight', 'chainHeightNote', 'mempoolCount', 'blockReward',
    'metricNodes', 'transferForm', 'recipientSelect', 'transferAmount', 'sendTransferButton',
    'transferNote', 'difficultyLabel', 'hashMachine', 'previousHash', 'candidateHash',
    'nonceCounter', 'targetLabel', 'mineButton', 'incidentResult', 'chainRibbon',
    'bestBlockHash', 'bestBlockHeight', 'bestBlockMiner', 'bestBlockTxCount', 'bestBlockNonce',
    'poolChip', 'mempoolList', 'openSummaryButton', 'rankingList', 'downloadLedgerButton',
    'copyLedgerButton', 'ledgerTable', 'ledgerEmpty', 'hostTools', 'addBotsButton',
    'markColludersButton', 'resetRoomButton', 'qrDialog', 'qrCanvas', 'qrRoomCode',
    'qrLinkText', 'copyQrLinkButton', 'summaryDialog', 'summaryNumbers', 'summaryRanking',
    'summaryConclusions', 'summaryDownloadButton', 'identityDialog', 'toast', 'confetti',
    'quickHelpButton', 'helpButton', 'helpDialog', 'coachPanel', 'coachStepNumber',
    'coachTitle', 'coachText', 'coachQrButton',
  ];
  ids.forEach((id) => {
    ui[id] = document.getElementById(id);
  });
}

function bindEvents() {
  ui.entryForm.addEventListener('submit', handleEntrySubmit);
  ui.quickHelpButton.addEventListener('click', () => openDialog(ui.helpDialog));
  ui.helpButton.addEventListener('click', () => openDialog(ui.helpDialog));
  ui.coachQrButton.addEventListener('click', handleCoachAction);
  ui.offlineDemoButton.addEventListener('click', () => createRoom(true));
  ui.cancelJoinButton.addEventListener('click', () => {
    history.replaceState(null, '', location.pathname);
    configureIncomingRoom();
  });
  ui.roomCodeButton.addEventListener('click', () => copyText(buildInviteLink(), '邀请链接已复制'));
  ui.qrButton.addEventListener('click', openQrDialog);
  ui.copyQrLinkButton.addEventListener('click', () => copyText(buildInviteLink(), '邀请链接已复制'));
  ui.presentButton.addEventListener('click', togglePresentation);
  ui.transferForm.addEventListener('submit', submitTransfer);
  ui.mineButton.addEventListener('click', startMining);
  ui.showIdentityButton.addEventListener('click', () => openDialog(ui.identityDialog));
  ui.openSummaryButton.addEventListener('click', openSummary);
  ui.summaryDownloadButton.addEventListener('click', downloadLedger);
  ui.downloadLedgerButton.addEventListener('click', downloadLedger);
  ui.copyLedgerButton.addEventListener('click', copyLedger);
  ui.addBotsButton.addEventListener('click', addExampleNodes);
  ui.markColludersButton.addEventListener('click', markAttackLeague);
  ui.resetRoomButton.addEventListener('click', resetRoom);

  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById(button.dataset.closeDialog);
      closeDialog(dialog);
    });
  });
  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
    dialog.addEventListener('close', () => {
      if (!document.querySelector('dialog[open]')) {
        document.body.classList.remove('modal-open');
      }
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('presenting')) {
      togglePresentation();
    }
  });
  document.querySelectorAll('[data-incident]').forEach((button) => {
    button.addEventListener('click', () => runIncident(button.dataset.incident));
  });
}

function renderStaticDefaults() {
  ui.difficultyLabel.textContent = '0'.repeat(DIFFICULTY);
  ui.targetLabel.textContent = `${'0'.repeat(DIFFICULTY)}…`;
  ui.blockReward.textContent = String(BLOCK_REWARD);
  ui.playerName.focus({ preventScroll: true });
}

function configureIncomingRoom() {
  const room = new URLSearchParams(location.search).get('room');
  if (!room) {
    ui.roomJoinField.hidden = true;
    ui.createActions.hidden = false;
    ui.joinActions.hidden = true;
    ui.entryHint.textContent = '创建一间课堂房间，电脑作为投影台；学生扫码后用六位房间号加入。';
    ui.entryMessage.textContent = '密钥只保存在当前标签页。这里没有真实私钥、充值或提现。';
    return;
  }

  const normalized = sanitizeRoom(room);
  if (!normalized) return;
  ui.roomJoinField.hidden = false;
  ui.roomCodeInput.value = normalized;
  ui.roomCodeInput.readOnly = true;
  ui.createActions.hidden = true;
  ui.joinActions.hidden = false;
  ui.entryHint.textContent = `你正在加入房间 ${normalized}。输入昵称后，浏览器会在本机生成签名密钥。`;
  ui.entryMessage.textContent = '加入后会同步到老师的大屏。不要提交真实姓名以外的敏感信息。';
}

async function handleEntrySubmit(event) {
  event.preventDefault();
  const name = cleanName(ui.playerName.value);
  if (!name) {
    setEntryMessage('请先输入一个昵称。', true);
    ui.playerName.focus();
    return;
  }

  const incomingRoom = sanitizeRoom(ui.roomCodeInput.value);
  if (incomingRoom && !ui.roomJoinField.hidden) {
    await joinRoom(incomingRoom, name);
  } else {
    await createRoom(false, name);
  }
}

function setEntryMessage(message, isError = false) {
  ui.entryMessage.textContent = message;
  ui.entryMessage.style.color = isError ? '#a64437' : '';
}

function setEntryBusy(busy, label = '连接中…') {
  ui.createRoomButton.disabled = busy;
  ui.joinRoomButton.disabled = busy;
  ui.offlineDemoButton.disabled = busy;
  if (busy) {
    ui.createRoomButton.textContent = label;
    ui.joinRoomButton.textContent = label;
  } else {
    ui.createRoomButton.innerHTML = '创建课堂房间 <span>→</span>';
    ui.joinRoomButton.innerHTML = '加入房间 <span>→</span>';
  }
}

async function createRoom(offline, suppliedName = '') {
  const name = cleanName(suppliedName || ui.playerName.value);
  if (!name) {
    setEntryMessage('请先输入一个昵称。', true);
    return;
  }

  setEntryBusy(true, offline ? '正在初始化…' : '正在连接…');
  setEntryMessage(offline ? '正在建立本地账本…' : '正在连接课堂中继，请稍候。');
  try {
    const identity = await createIdentity(name);
    const room = randomRoomCode();
    app.room = room;
    app.role = 'host';
    app.offline = offline;
    app.identity = identity;
    app.state = createInitialState(room, identity);
    app.waitingForSnapshot = false;
    showGame();

    if (offline) {
      setConnectionStatus('offline', '离线单人模式 · 数据只保存在本页');
      render();
    } else {
      await connectSync(true);
      if (app.sync?.ready) {
        setTimeout(() => {
          if (app.role === 'host' && !ui.gamePanel.hidden) openQrDialog();
        }, 350);
      }
    }
    setEntryBusy(false);
    persistSession();
  } catch (error) {
    console.error(error);
    setEntryMessage(`初始化失败：${friendlyError(error)}`, true);
    setEntryBusy(false);
  }
}

async function joinRoom(room, name) {
  setEntryBusy(true, '正在加入…');
  setEntryMessage('正在申请加入房间，并等待老师的大屏发来账本快照。');
  try {
    const identity = await createIdentity(name);
    app.room = room;
    app.role = 'guest';
    app.offline = false;
    app.identity = identity;
    app.state = null;
    app.waitingForSnapshot = true;

    const snapshotPromise = waitForSnapshot(18000);
    const sync = createSyncClient();
    app.sync = sync;
    await sync.connect();
    sendHello();
    setEntryMessage('已连接到消息中继，正在等待账本快照…');
    await snapshotPromise;
    showGame();
    setEntryBusy(false);
    persistSession();
  } catch (error) {
    console.error(error);
    app.sync?.disconnect();
    app.sync = null;
    app.waitingForSnapshot = false;
    app.snapshotWaiter = null;
    setEntryMessage(`加入失败：${friendlyError(error)}。请确认老师的房间仍开着，然后重试。`, true);
    setEntryBusy(false);
  }
}

function createSyncClient() {
  const topic = `${MQTT_TOPIC_PREFIX}/${app.room}`;
  const client = new MiniMqtt({
    url: MQTT_BROKER,
    topic,
    clientId: `bl_${randomToken(14)}`,
    onMessage: handleNetworkMessage,
    onStatus: handleConnectionStatus,
    onReady: () => {
      if (app.role === 'host' && app.state) {
        publishSnapshot();
      } else if (app.role === 'guest') {
        sendHello();
      }
    },
  });
  return client;
}

async function connectSync(isHost) {
  app.sync?.disconnect();
  app.sync = createSyncClient();
  try {
    await app.sync.connect();
    if (isHost) {
      setConnectionStatus('ready', '房间已上线 · 手机可以扫码加入');
      publishSnapshot();
    }
  } catch (error) {
    console.error(error);
    if (isHost) {
      setConnectionStatus('error', '联网中继不可用 · 可继续在本机演示');
      showToast('联网中继暂时不可用。当前页面仍可单独演示。', true);
    } else {
      throw error;
    }
  }
}

function handleConnectionStatus(status, label) {
  if (!app.state) return;
  if (status === 'ready') {
    setConnectionStatus('ready', app.role === 'host' ? '房间已上线 · 多人同步中' : '已同步 · 账本实时更新');
  } else if (status === 'connecting') {
    setConnectionStatus('', label || '正在连接课堂中继');
  } else if (status === 'error') {
    setConnectionStatus('error', '同步暂不可用 · 正在自动重试');
  }
}

function setConnectionStatus(kind, text) {
  ui.roomStatus.className = `room-pulse ${kind || ''}`.trim();
  ui.roomStatus.querySelector('span').textContent = text;
}

function waitForSnapshot(timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      app.waitingForSnapshot = false;
      app.snapshotWaiter = null;
      reject(new Error('等待大屏响应超时'));
    }, timeoutMs);
    app.snapshotWaiter = {
      resolve: (value) => {
        clearTimeout(timer);
        app.waitingForSnapshot = false;
        app.snapshotWaiter = null;
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        app.waitingForSnapshot = false;
        app.snapshotWaiter = null;
        reject(error);
      },
    };
  });
}

function sendHello() {
  if (!app.sync || !app.identity) return;
  app.sync.publish({
    type: 'hello',
    room: app.room,
    sender: app.identity.id,
    player: {
      id: app.identity.id,
      name: app.identity.name,
      address: app.identity.address,
      pubKey: app.identity.pubKey,
    },
  });
}

function handleNetworkMessage(message) {
  if (!message || message.room !== app.room) return;

  if (message.type === 'notice') {
    if (!message.target || message.target === app.identity?.id) {
      showToast(message.message || '账本拒绝了这次操作。', Boolean(message.error));
    }
    return;
  }

  if (message.type === 'snapshot') {
    if (app.role === 'guest') {
      app.state = message.state;
      persistSession();
      if (app.waitingForSnapshot && app.snapshotWaiter) {
        app.snapshotWaiter.resolve(true);
      }
      if (!ui.gamePanel.hidden) render();
    }
    return;
  }

  if (app.role === 'host' && app.state) {
    if (message.type === 'hello') {
      enqueueHost(() => registerRemotePlayer(message));
    } else if (message.type === 'action') {
      enqueueHost(() => handleHostAction(message));
    } else if (message.type === 'request-state') {
      publishSnapshot();
    }
  }
}

function enqueueHost(task) {
  app.hostQueue = app.hostQueue
    .then(task)
    .catch((error) => {
      console.error(error);
      showToast(`处理课堂操作失败：${friendlyError(error)}`, true);
    });
}

function registerRemotePlayer(message) {
  if (!message.player || !validIdentifier(message.player.id)) return;
  const existing = app.state.players.find((p) => p.id === message.player.id);
  if (existing) {
    const nextName = cleanName(message.player.name) || existing.name;
    if (existing.name !== nextName) {
      existing.name = nextName;
      publishState();
    } else {
      publishSnapshot();
    }
    return;
  }

  if (app.state.players.length >= 64) {
    sendNotice(message.player.id, '这间教室已达到 64 个节点上限。', true);
    return;
  }

  const name = cleanName(message.player.name) || '匿名节点';
  app.state.players.push({
    id: message.player.id,
    name: uniqueName(name, app.state.players),
    address: message.player.address,
    pubKey: String(message.player.pubKey || '').slice(0, 1200),
    initialBalance: INITIAL_BALANCE,
    isHost: false,
    isBot: false,
    colluding: false,
    joinedAt: Date.now(),
  });
  app.state.narrative = {
    kind: 'join',
    text: `${name} 已成为新节点。每个人的设备都拿到了同一份账本快照。`,
    time: Date.now(),
  };
  publishState();
}

async function handleHostAction(message) {
  if (!message.action || typeof message.action !== 'object') return;
  const sender = app.state.players.find((p) => p.id === message.sender);
  if (!sender) {
    sendNotice(message.sender, '尚未登记为房间节点，请刷新后重新加入。', true);
    return;
  }

  if (message.action.kind === 'tx') {
    await hostAddTransaction(message.action.tx, sender, false);
  } else if (message.action.kind === 'doubleSpend') {
    await hostAddDoubleSpend(message.action.txs, sender);
  } else if (message.action.kind === 'mine') {
    await hostAcceptMinedBlock(message.action.candidate, sender);
  }
}

async function hostAddTransaction(tx, sender, allowConflict) {
  const validation = await validateIncomingTransaction(tx, sender);
  if (!validation.ok) {
    sendNotice(sender.id, validation.error, true);
    return false;
  }

  const derived = deriveLedger(app.state);
  const pendingOut = derived.pending
    .filter((item) => item.from === sender.id)
    .reduce((sum, item) => sum + item.amount + item.fee, 0);
  const available = (derived.accounts[sender.address] ?? 0) - pendingOut;
  if (!allowConflict && tx.amount + tx.fee > available) {
    sendNotice(sender.id, '可用余额不足：待确认交易会先占用你的余额。', true);
    return false;
  }
  if (allowConflict && tx.amount + tx.fee > (derived.accounts[sender.address] ?? 0)) {
    sendNotice(sender.id, '金额超过当前余额，无法广播。', true);
    return false;
  }

  if (app.state.txs.some((item) => item.id === tx.id)) return false;
  app.state.txs.push(normalizeTransaction(tx, sender, app.state));
  app.state.narrative = {
    kind: 'transaction',
    text: `${sender.name} 的转账签名有效，已进入待确认区。它还没有成为历史。`,
    time: Date.now(),
  };
  publishState();
  return true;
}

async function hostAddDoubleSpend(txs, sender) {
  if (!Array.isArray(txs) || txs.length !== 2) {
    sendNotice(sender.id, '双花实验需要两笔交易。', true);
    return;
  }
  const first = await hostAddTransaction(txs[0], sender, true);
  const second = await hostAddTransaction(txs[1], sender, true);
  if (first && second) {
    app.state.narrative = {
      kind: 'double-spend',
      text: '两笔互相冲突的交易都已被广播。下一块会先选择一笔；另一笔在主链余额检查中会失败。',
      time: Date.now(),
    };
    publishState();
  }
}

async function validateIncomingTransaction(tx, sender) {
  if (!tx || typeof tx !== 'object') return { ok: false, error: '交易格式无效。' };
  if (tx.from !== sender.id || tx.fromAddress !== sender.address) {
    return { ok: false, error: '签名身份与付款节点不一致。' };
  }
  const recipient = app.state.players.find((p) => p.address === tx.toAddress);
  if (!recipient || recipient.id === sender.id) {
    return { ok: false, error: '收款节点不存在，或不能给自己转账。' };
  }
  if (!Number.isInteger(tx.amount) || tx.amount < 1 || tx.amount > 50) {
    return { ok: false, error: '转账金额必须是 1 至 50 的整数。' };
  }
  if (tx.fee !== 1) return { ok: false, error: '本课堂固定矿工费为 1 CB。' };
  if (!validIdentifier(tx.id) || !Number.isFinite(tx.submittedAt)) {
    return { ok: false, error: '交易标识或时间戳无效。' };
  }
  if (!sender.pubKey || !tx.signature) {
    return { ok: false, error: '缺少可验证的数字签名。' };
  }

  try {
    const publicKey = await importPublicKey(sender.pubKey);
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      base64ToBytes(tx.signature),
      new TextEncoder().encode(transactionSigningData(tx)),
    );
    return valid ? { ok: true } : { ok: false, error: '数字签名无效，交易被拒绝。' };
  } catch (error) {
    console.error(error);
    return { ok: false, error: '无法验证该交易签名。' };
  }
}

function normalizeTransaction(tx, sender, state) {
  const recipient = state.players.find((p) => p.address === tx.toAddress);
  return {
    id: tx.id,
    from: sender.id,
    fromName: sender.name,
    fromAddress: sender.address,
    to: recipient.id,
    toName: recipient.name,
    toAddress: recipient.address,
    amount: tx.amount,
    fee: tx.fee,
    submittedAt: tx.submittedAt,
    salt: tx.salt,
    signature: tx.signature,
  };
}

async function hostAcceptMinedBlock(candidate, sender) {
  const validation = await validateMinedBlock(candidate, sender);
  if (!validation.ok) {
    sendNotice(sender.id, validation.error, true);
    return;
  }
  app.state.blocks.push(validation.block);
  app.state.bestTipId = chooseBestTip(app.state.blocks).id;
  const includedCount = validation.block.txIds.length;
  app.state.narrative = {
    kind: 'block',
    text: `${sender.name} 找到有效工作量证明，发布第 ${validation.block.height} 块；${includedCount} 笔交易获得确认。`,
    time: Date.now(),
  };
  publishState();
  showConfetti();
}

async function validateMinedBlock(candidate, minerPlayer) {
  if (!candidate || typeof candidate !== 'object') return { ok: false, error: '候选区块格式无效。' };
  const best = getBestBlock(app.state);
  if (candidate.parentId !== best.id || candidate.parentHash !== best.hash) {
    return { ok: false, error: '你基于旧区块挖矿；主链已经变化，请重新开始。' };
  }
  if (candidate.height !== best.height + 1) {
    return { ok: false, error: '候选区块高度不正确。' };
  }
  if (candidate.minerAddress !== minerPlayer.address) {
    return { ok: false, error: '出块奖励地址与操作节点不一致。' };
  }
  if (candidate.difficulty !== DIFFICULTY || !candidate.hash?.startsWith('0'.repeat(DIFFICULTY))) {
    return { ok: false, error: `工作量证明未达到 ${DIFFICULTY} 个前导零。` };
  }
  if (!validIdentifier(candidate.id) || !Number.isInteger(candidate.nonce) || !Number.isFinite(candidate.timestamp)) {
    return { ok: false, error: '候选区块字段不完整。' };
  }

  const txIds = Array.isArray(candidate.txIds) ? [...new Set(candidate.txIds)] : [];
  if (txIds.length !== (candidate.txIds || []).length || txIds.length > 64) {
    return { ok: false, error: '候选区块包含重复或过多交易。' };
  }
  const pending = deriveLedger(app.state).pending;
  const pendingMap = new Map(pending.map((tx) => [tx.id, tx]));
  if (txIds.some((id) => !pendingMap.has(id))) {
    return { ok: false, error: '区块引用了不存在或已确认的交易。' };
  }
  if (!validTransactionSet(txIds, pendingMap, deriveLedger(app.state).accounts)) {
    return { ok: false, error: '候选区块包含互相冲突或余额不足的交易。' };
  }

  const block = {
    id: candidate.id,
    height: candidate.height,
    parentId: candidate.parentId,
    parentHash: candidate.parentHash,
    miner: minerPlayer.name,
    minerAddress: minerPlayer.address,
    timestamp: Math.round(candidate.timestamp),
    difficulty: candidate.difficulty,
    nonce: candidate.nonce,
    txIds,
    reward: BLOCK_REWARD,
    hash: String(candidate.hash),
    builtBy: minerPlayer.id,
  };
  const expectedHash = await computeBlockHash(block);
  if (expectedHash !== block.hash) {
    return { ok: false, error: '区块哈希与内容不一致。' };
  }
  return { ok: true, block };
}

function validTransactionSet(txIds, txMap, startingAccounts) {
  const accounts = { ...startingAccounts };
  const conflictKeys = new Set();
  for (const id of txIds) {
    const tx = txMap.get(id);
    if (!tx || (accounts[tx.fromAddress] ?? 0) < tx.amount + tx.fee) return false;
    const conflictKey = transactionConflictKey(tx);
    if (conflictKeys.has(conflictKey)) return false;
    conflictKeys.add(conflictKey);
    accounts[tx.fromAddress] -= tx.amount + tx.fee;
    accounts[tx.toAddress] = (accounts[tx.toAddress] ?? 0) + tx.amount;
  }
  return true;
}

async function submitTransfer(event) {
  event.preventDefault();
  const player = currentPlayer();
  const recipient = app.state?.players.find((p) => p.id === ui.recipientSelect.value);
  const amount = Number(ui.transferAmount.value);
  if (!player || !recipient) {
    showToast('当前房间还没有其他可转账的节点。', true);
    return;
  }
  if (!Number.isInteger(amount) || amount < 1 || amount > 50) {
    showToast('请输入 1 至 50 之间的整数金额。', true);
    return;
  }
  ui.sendTransferButton.disabled = true;
  ui.transferNote.textContent = '正在用本机私钥签名…';
  try {
    const tx = await createSignedTransaction(player, recipient, amount, 1, 'single');
    if (app.role === 'host') {
      enqueueHost(() => hostAddTransaction(tx, player, false));
    } else {
      if (!app.sync?.publish({ type: 'action', room: app.room, sender: player.id, action: { kind: 'tx', tx } })) {
        throw new Error('尚未连接课堂中继');
      }
      showToast('已签名并广播，等待主链确认。');
    }
    ui.transferNote.textContent = '签名有效。交易已广播；挖到下一块后才算写进主链。';
  } catch (error) {
    console.error(error);
    showToast(friendlyError(error), true);
    ui.transferNote.textContent = '广播失败，请检查房间连接后重试。';
  } finally {
    ui.sendTransferButton.disabled = false;
    render();
  }
}

async function createSignedTransaction(fromPlayer, toPlayer, amount, fee, salt) {
  const submittedAt = Date.now();
  const id = `tx_${randomToken(12)}`;
  const tx = {
    id,
    from: fromPlayer.id,
    fromAddress: fromPlayer.address,
    to: toPlayer.id,
    toAddress: toPlayer.address,
    amount,
    fee,
    submittedAt,
    salt,
  };
  const privateKey = await importPrivateKey(app.identity.privateJwk);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(transactionSigningData(tx)),
  );
  return { ...tx, signature: bytesToBase64(signature) };
}

function transactionSigningData(tx) {
  return ['CONSENSUS-LAB-TX-1', tx.id, tx.fromAddress, tx.toAddress, tx.amount, tx.fee, tx.submittedAt, tx.salt].join('|');
}

function transactionConflictKey(tx) {
  return typeof tx.salt === 'string' && tx.salt.startsWith('double:') ? tx.salt : tx.id;
}

async function startMining() {
  if (app.mining || !app.state) return;
  const player = currentPlayer();
  if (!player) return;
  app.mining = true;
  ui.mineButton.disabled = true;
  ui.mineButton.classList.add('mining');
  ui.mineButton.innerHTML = '<span class="mine-dot"></span>正在计算 nonce… <span>…</span>';
  const best = getBestBlock(app.state);
  const derived = deriveLedger(app.state);
  const txIds = chooseMineableTransactions(derived.pending, derived.accounts);
  const candidate = {
    id: `blk_${randomToken(12)}`,
    height: best.height + 1,
    parentId: best.id,
    parentHash: best.hash,
    miner: player.name,
    minerAddress: player.address,
    timestamp: Date.now(),
    difficulty: DIFFICULTY,
    nonce: 0,
    txIds,
    reward: BLOCK_REWARD,
    builtBy: player.id,
  };

  try {
    ui.previousHash.textContent = shorten(best.hash, 18, 12);
    ui.candidateHash.textContent = '计算中…';
    ui.chainHeightNote.textContent = `正在竞争第 ${candidate.height} 块`;
    const result = await findProofOfWork(candidate, (nonce, hash) => {
      ui.nonceCounter.textContent = nonce.toLocaleString('zh-CN');
      ui.candidateHash.textContent = shorten(hash, 15, 12);
    });
    candidate.nonce = result.nonce;
    candidate.hash = result.hash;
    ui.candidateHash.textContent = shorten(result.hash, 18, 14);
    ui.candidateHash.classList.add('valid');
    ui.mineButton.innerHTML = '<span class="mine-dot"></span>已找到，广播区块 <span>✓</span>';

    if (app.role === 'host') {
      enqueueHost(() => hostAcceptMinedBlock(candidate, player));
    } else {
      if (!app.sync?.publish({
        type: 'action',
        room: app.room,
        sender: player.id,
        action: { kind: 'mine', candidate },
      })) {
        throw new Error('尚未连接课堂中继');
      }
      showToast(`找到哈希 ${result.hash.slice(0, 14)}…，区块已广播。`);
    }
  } catch (error) {
    console.error(error);
    showToast(friendlyError(error), true);
  } finally {
    app.mining = false;
    ui.mineButton.disabled = false;
    ui.mineButton.classList.remove('mining');
    ui.mineButton.innerHTML = '<span class="mine-dot"></span>开始挖矿 <span>↗</span>';
  }
}

async function findProofOfWork(blockTemplate, progress) {
  const target = '0'.repeat(blockTemplate.difficulty);
  const maxNonce = 8_000_000;
  for (let nonce = 0; nonce < maxNonce; nonce += 1) {
    const candidate = { ...blockTemplate, nonce };
    const hash = await computeBlockHash(candidate);
    if (hash.startsWith(target)) {
      progress(nonce, hash);
      return { nonce, hash };
    }
    if (nonce % 256 === 0) {
      progress(nonce, hash);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }
  throw new Error('本轮没有找到结果，请再点一次。');
}

async function computeBlockHash(block) {
  const merkle = await sha256Hex([...(block.txIds || [])].sort().join('|'));
  const header = [
    'CONSENSUS-LAB-BLOCK-1',
    block.height,
    block.parentId,
    block.parentHash,
    merkle,
    block.minerAddress,
    Math.round(block.timestamp),
    block.difficulty,
    block.nonce,
  ].join('|');
  return sha256Hex(header);
}

function chooseMineableTransactions(pending, startingAccounts) {
  const accounts = { ...startingAccounts };
  const result = [];
  const conflictKeys = new Set();
  for (const tx of pending) {
    const conflictKey = transactionConflictKey(tx);
    if (conflictKeys.has(conflictKey)) continue;
    if ((accounts[tx.fromAddress] ?? 0) < tx.amount + tx.fee) continue;
    conflictKeys.add(conflictKey);
    accounts[tx.fromAddress] -= tx.amount + tx.fee;
    accounts[tx.toAddress] = (accounts[tx.toAddress] ?? 0) + tx.amount;
    result.push(tx.id);
  }
  return result;
}

async function runIncident(kind) {
  if (app.incidentBusy || !app.state) return;
  if (kind === 'double') {
    await runDoubleSpend();
  } else if (kind === 'fork') {
    if (app.role !== 'host') return;
    await runFork();
  } else if (kind === 'attack') {
    if (app.role !== 'host') return;
    await runAttack();
  }
}

async function runDoubleSpend() {
  const player = currentPlayer();
  const recipients = app.state.players.filter((p) => p.id !== player?.id);
  if (!player || recipients.length < 2) {
    setIncidentResult('双花实验至少需要三个节点。老师可在教师台加入示例节点。', true);
    return;
  }
  const derived = deriveLedger(app.state);
  const available = (derived.accounts[player.address] ?? 0) -
    derived.pending.filter((tx) => tx.from === player.id).reduce((sum, tx) => sum + tx.amount + tx.fee, 0);
  if (available < 2) {
    setIncidentResult('至少需要 2 CB 可用余额才能广播互相冲突的交易。', true);
    return;
  }
  const conflictAmount = Math.min(50, available - 1);

  app.incidentBusy = true;
  setIncidentResult('正在用你的私钥分别签署两笔交易…', false);
  try {
    const conflictSalt = `double:${randomToken(10)}`;
    const txA = await createSignedTransaction(player, recipients[0], conflictAmount, 1, conflictSalt);
    const txB = await createSignedTransaction(player, recipients[1], conflictAmount, 1, conflictSalt);
    if (app.role === 'host') {
      enqueueHost(() => hostAddDoubleSpend([txA, txB], player));
    } else {
      app.sync?.publish({
        type: 'action',
        room: app.room,
        sender: player.id,
        action: { kind: 'doubleSpend', txs: [txA, txB] },
      });
    }
    setIncidentResult(`两笔 ${conflictAmount} CB 的签名都有效，且都已广播。现在去挖下一块，看看账本只接受哪一笔。`, false);
  } catch (error) {
    setIncidentResult(friendlyError(error), true);
  } finally {
    app.incidentBusy = false;
  }
}

async function runFork() {
  app.incidentBusy = true;
  setIncidentResult('两位矿工正在基于同一个父区块搜索 nonce…', false);
  try {
    const best = getBestBlock(app.state);
    const miners = app.state.players.length > 1 ? app.state.players.slice(0, 2) : [app.state.players[0], app.state.players[0]];
    const templates = [0, 1].map((index) => ({
      id: `blk_${randomToken(12)}`,
      height: best.height + 1,
      parentId: best.id,
      parentHash: best.hash,
      miner: miners[index].name,
      minerAddress: miners[index].address,
      timestamp: Date.now() + index,
      difficulty: DIFFICULTY,
      nonce: 0,
      txIds: [],
      reward: BLOCK_REWARD,
      builtBy: miners[index].id,
    }));
    const [resultA, resultB] = await Promise.all(templates.map((template) => findProofOfWork(template, () => {})));
    templates[0].nonce = resultA.nonce;
    templates[0].hash = resultA.hash;
    templates[1].nonce = resultB.nonce;
    templates[1].hash = resultB.hash;
    app.state.blocks.push(...templates);
    app.state.bestTipId = chooseBestTip(app.state.blocks).id;
    app.state.narrative = {
      kind: 'fork',
      text: `两个合法区块同时出现，都指向第 ${best.height} 块。课堂用确定规则暂时选中一条，但另一条分支仍被保留下来观察。`,
      time: Date.now(),
    };
    publishState();
    setIncidentResult('分叉发生了：两个邻居看到的是不同分支。系统必须用同一个规则重新收敛。', false);
  } catch (error) {
    setIncidentResult(friendlyError(error), true);
  } finally {
    app.incidentBusy = false;
  }
}

async function runAttack() {
  const colluding = app.state.players.filter((p) => p.colluding);
  const power = colluding.reduce((sum, p) => sum + 1, 0);
  const totalPower = app.state.players.length;
  if (!totalPower || power <= totalPower / 2) {
    setIncidentResult('攻击失败：你还没有控制超过一半的节点算力。先点击“标记逾半攻击联盟”。', true);
    return;
  }

  const derived = deriveLedger(app.state);
  const path = derived.path;
  const hostileIds = new Set(colluding.map((p) => p.id));
  let targetBlock = null;
  let targetTx = null;
  for (let index = path.length - 1; index >= 1; index -= 1) {
    const block = path[index];
    const tx = block.txIds.map((id) => app.state.txs.find((item) => item.id === id)).find((item) => item && hostileIds.has(item.from));
    if (tx) {
      targetBlock = block;
      targetTx = tx;
      break;
    }
  }
  if (!targetBlock) {
    setIncidentResult('还没有可改写的近期交易。请让攻击联盟中的节点先转出一笔，并等它进入主链。', true);
    return;
  }

  app.incidentBusy = true;
  setIncidentResult(`攻击联盟控制 ${power}/${totalPower} 份算力，正在秘密重算第 ${targetBlock.height} 块之后的替代链…`, false);
  try {
    const byId = new Map(app.state.blocks.map((block) => [block.id, block]));
    const parent = byId.get(targetBlock.parentId);
    const blocks = [];
    let localParent = parent;
    const needed = getBestBlock(app.state).height - parent.height + 1;
    for (let index = 0; index < needed; index += 1) {
      const template = {
        id: `blk_${randomToken(12)}`,
        height: localParent.height + 1,
        parentId: localParent.id,
        parentHash: localParent.hash,
        miner: colluding[0].name,
        minerAddress: colluding[0].address,
        timestamp: Date.now() + index * 7,
        difficulty: DIFFICULTY,
        nonce: 0,
        txIds: [],
        reward: BLOCK_REWARD,
        builtBy: colluding[0].id,
        attackBranch: true,
      };
      const proof = await findProofOfWork(template, () => {});
      template.nonce = proof.nonce;
      template.hash = proof.hash;
      blocks.push(template);
      localParent = template;
    }
    app.state.blocks.push(...blocks);
    app.state.bestTipId = chooseBestTip(app.state.blocks).id;
    app.state.attackHistory = app.state.attackHistory || [];
    app.state.attackHistory.push({
      at: Date.now(),
      power,
      totalPower,
      rewrittenFrom: targetBlock.height,
      targetTx: targetTx.id,
      note: '攻击联盟用更长的秘密分支替换了公开分支。它可以审查和重排近期交易，但仍不能伪造其他节点的签名。',
    });
    app.state.narrative = {
      kind: 'attack',
      text: `多数算力用了一条更长分支：第 ${targetBlock.height} 块之后的公开历史被替换。交易顺序可被改写，其他用户签名仍不可伪造。`,
      time: Date.now(),
    };
    publishState();
    setIncidentResult(`重组成功：${targetTx.fromName} 的那笔近期交易被移出主链。其他地址的币没有被偷走，因为攻击者没有它们的私钥。`, true);
  } catch (error) {
    setIncidentResult(friendlyError(error), true);
  } finally {
    app.incidentBusy = false;
  }
}

function markAttackLeague() {
  if (app.role !== 'host' || !app.state) return;
  const needed = Math.floor(app.state.players.length / 2) + 1;
  app.state.players.forEach((player, index) => {
    player.colluding = index < needed;
  });
  app.state.narrative = {
    kind: 'attack-league',
    text: `已模拟 ${needed} 个节点交出算力，形成超过半数的攻击联盟。现在可以点击“51% 多数算力改写”。`,
    time: Date.now(),
  };
  publishState();
  showToast('逾半节点已标记为攻击联盟。先转出一笔账，再发动重组演示。');
}

function addExampleNodes() {
  if (app.role !== 'host' || !app.state) return;
  if (app.state.players.length >= 60) {
    showToast('节点数量已接近课堂上限。', true);
    return;
  }
  const suffixes = ['甲', '乙', '丙', '丁', '戊'];
  suffixes.forEach((suffix, index) => {
    const id = `bot_${randomToken(10)}`;
    app.state.players.push({
      id,
      name: `示例节点 ${suffix}`,
      address: addressFromSeed(`example-${app.room}-${Date.now()}-${index}`),
      pubKey: '',
      initialBalance: INITIAL_BALANCE,
      isHost: false,
      isBot: true,
      colluding: false,
      joinedAt: Date.now() + index,
    });
  });
  app.state.narrative = {
    kind: 'nodes',
    text: '教师台加入了 5 个示例节点，仅用于同桌演示或小班补位；它们不是扫码上线的真实参与者。',
    time: Date.now(),
  };
  publishState();
}

function resetRoom() {
  if (app.role !== 'host' || !app.state) return;
  const players = app.state.players.map((player) => ({ ...player, colluding: false }));
  app.state = createInitialState(app.room, app.identity, players);
  app.state.narrative = {
    kind: 'reset',
    text: '账本已重置。身份节点保留，区块与交易历史归零。',
    time: Date.now(),
  };
  publishState();
  setIncidentResult('账本已回到创世块。身份节点保留，交易历史清空。', false);
}

function createInitialState(room, identity, existingPlayers = null) {
  const genesis = {
    id: `genesis_${room}`,
    height: 0,
    parentId: null,
    parentHash: GENESIS_HASH,
    miner: '创世规则',
    minerAddress: 'GENESIS',
    timestamp: Date.now(),
    difficulty: DIFFICULTY,
    nonce: 0,
    txIds: [],
    reward: 0,
    hash: GENESIS_HASH,
    builtBy: 'system',
  };
  const players = existingPlayers || [{
    id: identity.id,
    name: identity.name,
    address: identity.address,
    pubKey: identity.pubKey,
    initialBalance: INITIAL_BALANCE,
    isHost: true,
    isBot: false,
    colluding: false,
    joinedAt: Date.now(),
  }];
  return {
    room,
    hostId: identity.id,
    reward: BLOCK_REWARD,
    difficulty: DIFFICULTY,
    players,
    blocks: [genesis],
    txs: [],
    bestTipId: genesis.id,
    attackHistory: [],
    narrative: {
      kind: 'genesis',
      text: '创世规则给每个节点 100 CB。没有银行，也没有可任意改动余额的管理员页面。',
      time: Date.now(),
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function deriveLedger(state) {
  if (!state) {
    return { accounts: {}, txStatuses: {}, pending: [], path: [], included: [], rejected: [], orphaned: [] };
  }
  const accounts = {};
  state.players.forEach((player) => {
    accounts[player.address] = player.initialBalance ?? INITIAL_BALANCE;
  });
  const txStatuses = {};
  const txMap = new Map(state.txs.map((tx) => [tx.id, tx]));
  const usedConflictKeys = new Set();

  const byId = new Map(state.blocks.map((block) => [block.id, block]));
  let cursor = byId.get(state.bestTipId) || getBestBlock(state);
  const path = [];
  const seen = new Set();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    path.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
  }
  const canonicalIds = new Set(path.map((block) => block.id));

  for (const block of path.slice(1)) {
    for (const txId of block.txIds) {
      const tx = txMap.get(txId);
      if (!tx) {
        txStatuses[txId] = { status: 'rejected', reason: '交易内容缺失' };
        continue;
      }
      if ((accounts[tx.fromAddress] ?? 0) < tx.amount + tx.fee) {
        txStatuses[tx.id] = { status: 'rejected', blockId: block.id, reason: '余额不足或双花冲突' };
        continue;
      }
      accounts[tx.fromAddress] -= tx.amount + tx.fee;
      accounts[tx.toAddress] = (accounts[tx.toAddress] ?? 0) + tx.amount;
      usedConflictKeys.add(transactionConflictKey(tx));
      txStatuses[tx.id] = { status: 'included', blockId: block.id, reason: '已写入主链' };
    }
    accounts[block.minerAddress] = (accounts[block.minerAddress] ?? 0) + (block.reward || 0);
  }

  const nonCanonicalTxIds = new Set();
  for (const block of state.blocks) {
    if (!canonicalIds.has(block.id)) {
      block.txIds.forEach((id) => nonCanonicalTxIds.add(id));
    }
  }

  for (const tx of state.txs) {
    if (txStatuses[tx.id]?.status === 'included') continue;
    if (nonCanonicalTxIds.has(tx.id)) {
      txStatuses[tx.id] = { status: 'orphaned', reason: '所在分支已被主链替换' };
    } else if (usedConflictKeys.has(transactionConflictKey(tx))) {
      txStatuses[tx.id] = { status: 'rejected', reason: '与主链交易引用同一笔可花费余额' };
    } else if ((accounts[tx.fromAddress] ?? 0) < tx.amount + tx.fee) {
      txStatuses[tx.id] = { status: 'rejected', reason: '与主链交易冲突，余额已不足' };
    } else if (!txStatuses[tx.id]) {
      txStatuses[tx.id] = { status: 'pending', reason: '等待矿工打包' };
    }
  }

  const pending = state.txs.filter((tx) => txStatuses[tx.id]?.status === 'pending')
    .sort((a, b) => a.submittedAt - b.submittedAt);
  const included = state.txs.filter((tx) => txStatuses[tx.id]?.status === 'included');
  const rejected = state.txs.filter((tx) => txStatuses[tx.id]?.status === 'rejected');
  const orphaned = state.txs.filter((tx) => txStatuses[tx.id]?.status === 'orphaned');
  return { accounts, txStatuses, pending, included, rejected, orphaned, path, canonicalIds };
}

function getBestBlock(state) {
  return chooseBestTip(state.blocks);
}

function chooseBestTip(blocks) {
  return blocks.reduce((best, block) => {
    if (block.height > best.height) return block;
    if (block.height === best.height && block.hash < best.hash) return block;
    return best;
  }, blocks[0]);
}

function publishState() {
  if (app.role !== 'host' || !app.state) return;
  app.state.updatedAt = Date.now();
  persistSession();
  render();
  publishSnapshot();
}

function publishSnapshot() {
  if (!app.sync || !app.state) return;
  app.sync.publish({ type: 'snapshot', room: app.room, state: app.state, sentAt: Date.now() });
}

function sendNotice(target, message, error = false) {
  if (target === app.identity?.id && app.role === 'host') {
    showToast(message, error);
    return;
  }
  app.sync?.publish({ type: 'notice', room: app.room, target, message, error });
}

function submitAction(action) {
  if (!app.sync?.publish({
    type: 'action',
    room: app.room,
    sender: app.identity.id,
    action,
  })) {
    throw new Error('尚未连接课堂中继');
  }
}

function render() {
  if (!app.state || !ui.gamePanel) return;
  const player = currentPlayer();
  const derived = deriveLedger(app.state);
  const best = getBestBlock(app.state);
  const isHost = app.role === 'host';
  const balance = player ? derived.accounts[player.address] ?? 0 : 0;
  const playerPending = player ? derived.pending.filter((tx) => tx.from === player.id) : [];
  const playerIncluded = player ? derived.included.filter((tx) => tx.from === player.id) : [];
  const forks = app.state.blocks.filter((block) => !derived.canonicalIds.has(block.id));

  ui.roomCode.textContent = app.room;
  ui.nodeCount.textContent = `${app.state.players.length} 个节点`;
  ui.metricNodes.textContent = String(app.state.players.length);
  ui.playerAvatar.textContent = player?.name?.slice(0, 1) || '?';
  ui.playerRole.textContent = isHost ? '发起节点 · 投影台' : player?.isBot ? '示例节点' : '加入节点';
  ui.playerDisplayName.textContent = player?.name || app.identity.name;
  ui.playerBalance.textContent = formatNumber(balance);
  ui.playerAddress.textContent = player?.address || app.identity.address;
  ui.playerConfirmed.textContent = String(playerIncluded.length);
  ui.playerPending.textContent = String(playerPending.length);
  ui.chainHeight.textContent = String(best.height);
  ui.chainHeightNote.textContent = best.height === 0 ? '创世块' : `最新 #${shorten(best.hash, 8, 4)}`;
  ui.mempoolCount.textContent = String(derived.pending.length);
  ui.metricNodes.textContent = String(app.state.players.length);
  ui.difficultyLabel.textContent = '0'.repeat(app.state.difficulty);
  ui.targetLabel.textContent = `${'0'.repeat(app.state.difficulty)}…`;

  ui.hostTools.hidden = !isHost;
  document.querySelectorAll('.host-only').forEach((element) => {
    element.hidden = !isHost;
  });

  renderRecipients(player, derived);
  renderChain(derived, best);
  renderMempool(derived);
  renderRanking(derived, player);
  renderLedgerTable(derived);
  renderIncidentResult();
  renderCoach(derived, player);

  ui.poolChip.textContent = `${derived.pending.length} 笔`;
  ui.bestBlockHash.textContent = shorten(best.hash, 20, 14);
  ui.bestBlockHeight.textContent = String(best.height);
  ui.bestBlockMiner.textContent = best.miner;
  ui.bestBlockTxCount.textContent = String(best.txIds.length);
  ui.bestBlockNonce.textContent = String(best.nonce);
  ui.previousHash.textContent = shorten(best.hash, 18, 12);

  const hasRecipients = app.state.players.some((p) => p.id !== player?.id);
  ui.sendTransferButton.disabled = !hasRecipients || balance < 2;
  ui.mineButton.disabled = app.mining;
  if (!hasRecipients) {
    ui.transferNote.textContent = '需要至少两个节点才能转账。可以扫码邀请同学，或由老师在教师台加入示例节点。';
  } else if (balance < 2) {
    ui.transferNote.textContent = '当前可用余额不足以支付转账和矿工费。等待其他节点给你转账或挖矿。';
  } else if (derived.pending.length === 0) {
    ui.transferNote.textContent = '数字签名证明“是你同意”，余额检查防止你花超过自己拥有的币。';
  }

  if (forks.length > 0) {
    ui.chainHeightNote.textContent = `共 ${forks.length} 个非主链区块`;
  }

  const activeContract = app.state.narrative?.text || '';
  if (activeContract && !ui.incidentResult.dataset.locked) {
    ui.incidentResult.textContent = activeContract;
    ui.incidentResult.classList.toggle('alert', ['attack', 'double-spend'].includes(app.state.narrative?.kind));
  }
}

function renderCoach(derived, player) {
  if (!ui.coachPanel || !app.state) return;
  const isHost = app.role === 'host';
  const hasOthers = app.state.players.some((item) => item.id !== player?.id);
  const hasAnyTx = app.state.txs.length > 0;
  const hasPending = derived.pending.length > 0;
  const hasConfirmed = derived.included.length > 0;
  let step = 2;
  let title = '先发起一笔转账';
  let text = '选择另一位同学，转账 5 CB。交易先进入待确认区，还不算完成。';
  let action = 'transfer';
  let actionLabel = '去转账';

  if (isHost && !hasOthers) {
    step = 1;
    title = '先让同学扫码加入';
    text = '点击右侧“显示二维码”，同学扫码后会进入这个房间。只想单人演示时，也可以在教师台加入 5 个示例节点。';
    action = 'qr';
    actionLabel = '显示二维码';
  } else if (!hasAnyTx) {
    step = 2;
  } else if (hasPending) {
    step = 3;
    title = '现在让矿工打包';
    text = `待确认区里有 ${derived.pending.length} 笔交易。点击“开始挖矿”，先找到以三个 0 开头的哈希者获得记账权。`;
    action = 'mine';
    actionLabel = '去挖矿';
  } else if (hasConfirmed) {
    step = 4;
    title = '第一块已经写入账本';
    text = '继续转账并挖矿，或点击“课堂复盘”查看财富排行、双花、分叉和完整流水。';
    action = 'summary';
    actionLabel = '课堂复盘';
  }

  ui.coachStepNumber.textContent = String(step);
  ui.coachTitle.textContent = title;
  ui.coachText.textContent = text;
  ui.coachQrButton.textContent = actionLabel;
  ui.coachQrButton.dataset.action = action;
  ui.coachPanel.classList.toggle('guest-coach', !isHost);
  ui.coachPanel.querySelectorAll('[data-step]').forEach((item) => {
    const itemStep = Number(item.dataset.step);
    item.classList.toggle('active', itemStep === step);
    item.classList.toggle('done', itemStep < step);
  });
}

function handleCoachAction() {
  const action = ui.coachQrButton.dataset.action;
  if (action === 'qr') {
    openQrDialog();
  } else if (action === 'transfer') {
    document.querySelector('.transaction-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    ui.recipientSelect.focus({ preventScroll: true });
  } else if (action === 'mine') {
    document.querySelector('.mining-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => ui.mineButton.focus({ preventScroll: true }), 350);
  } else if (action === 'summary') {
    openSummary();
  }
}

function renderRecipients(player, derived) {
  if (!player) return;
  const previous = ui.recipientSelect.value;
  const options = app.state.players
    .filter((p) => p.id !== player.id)
    .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} · ${escapeHtml(shortAddress(p.address))}</option>`)
    .join('');
  const empty = options ? '' : '<option value="">暂无其他节点</option>';
  ui.recipientSelect.innerHTML = empty + options;
  if ([...ui.recipientSelect.options].some((option) => option.value === previous)) {
    ui.recipientSelect.value = previous;
  }
}

function renderChain(derived, best) {
  const ordered = [...app.state.blocks].sort((a, b) => a.height - b.height || a.timestamp - b.timestamp);
  const shown = ordered.slice(-24);
  ui.chainRibbon.innerHTML = shown.map((block) => {
    const canonical = derived.canonicalIds.has(block.id);
    const classes = ['chain-chip'];
    if (canonical) classes.push('canonical');
    else classes.push('fork');
    if (block.height === 0) classes.push('genesis');
    return `<div class="${classes.join(' ')}" title="${escapeHtml(block.hash)}">
      <span>${canonical ? 'MAIN' : 'FORK'} · ${block.txIds.length} TX</span>
      <strong>#${block.height}</strong>
      <code>${escapeHtml(shorten(block.hash, 9, 5))}</code>
      <em></em>
    </div>`;
  }).join('');
  const activeChip = ui.chainRibbon.querySelector('.canonical:last-of-type');
  if (activeChip) activeChip.setAttribute('aria-current', 'step');
  ui.chainRibbon.scrollLeft = ui.chainRibbon.scrollWidth;
}

function renderMempool(derived) {
  if (!derived.pending.length) {
    ui.mempoolList.innerHTML = '<div class="empty-state">还没有待确认交易。先发起一笔转账吧。</div>';
    return;
  }
  ui.mempoolList.innerHTML = derived.pending.slice(0, 12).map((tx) => `
    <div class="pool-item">
      <span class="tx-glyph">TX</span>
      <div><strong>${escapeHtml(tx.fromName)} → ${escapeHtml(tx.toName)}</strong><small>${escapeHtml(shortAddress(tx.fromAddress))} · ${formatTime(tx.submittedAt)}</small></div>
      <span>${formatNumber(tx.amount)} CB</span>
    </div>
  `).join('');
}

function renderRanking(derived, player) {
  const ranked = [...app.state.players]
    .map((item) => ({ ...item, balance: derived.accounts[item.address] ?? 0 }))
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name, 'zh-CN'));
  ui.rankingList.innerHTML = ranked.map((item, index) => `
    <div class="rank-row ${item.id === player?.id ? 'me' : ''} ${item.colluding ? 'attacker' : ''}">
      <b>${String(index + 1).padStart(2, '0')}</b>
      <div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(shortAddress(item.address))}</small></div>
      <em>${item.colluding ? '攻击联盟' : item.isBot ? '示例' : item.isHost ? '发起' : '节点'}</em>
      <span>${formatNumber(item.balance)} CB</span>
    </div>
  `).join('');
}

function renderLedgerTable(derived) {
  if (!app.state.txs.length) {
    ui.ledgerTable.innerHTML = '';
    ui.ledgerEmpty.hidden = false;
    return;
  }
  ui.ledgerEmpty.hidden = true;
  const statusLabel = {
    pending: '待确认',
    included: '已确认',
    rejected: '已拒绝',
    orphaned: '分支失效',
  };
  ui.ledgerTable.innerHTML = [...app.state.txs]
    .sort((a, b) => b.submittedAt - a.submittedAt)
    .map((tx) => {
      const info = derived.txStatuses[tx.id] || { status: 'pending' };
      return `<tr title="${escapeHtml(info.reason || '')}">
        <td>${formatTime(tx.submittedAt)}</td>
        <td>${escapeHtml(tx.fromName)} · ${escapeHtml(shortAddress(tx.fromAddress))}</td>
        <td>${escapeHtml(tx.toName)} · ${escapeHtml(shortAddress(tx.toAddress))}</td>
        <td>${formatNumber(tx.amount)} CB <small>+${tx.fee} 费</small></td>
        <td><span class="${info.status}">${statusLabel[info.status] || info.status}</span></td>
        <td>${info.blockId ? `#${blockHeightById(info.blockId)}` : '—'}</td>
      </tr>`;
    }).join('');
}

function renderIncidentResult() {
  const narrative = app.state.narrative;
  if (!narrative) return;
  ui.incidentResult.textContent = narrative.text;
  ui.incidentResult.classList.toggle('alert', ['attack', 'double-spend'].includes(narrative.kind));
}

function setIncidentResult(message, alert) {
  ui.incidentResult.textContent = message;
  ui.incidentResult.classList.toggle('alert', alert);
}

function blockHeightById(blockId) {
  return app.state.blocks.find((block) => block.id === blockId)?.height ?? '?';
}

function currentPlayer() {
  return app.state?.players.find((player) => player.id === app.identity?.id);
}

function showGame() {
  ui.entryPanel.hidden = true;
  ui.gamePanel.hidden = false;
  updateInviteText();
  if (app.state) render();
}

function openQrDialog() {
  const link = buildInviteLink();
  updateInviteText();
  ui.qrCanvas.innerHTML = '';
  try {
    if (typeof qrcode !== 'function') throw new Error('二维码组件未加载');
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    ui.qrCanvas.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
  } catch (error) {
    console.error(error);
    ui.qrCanvas.textContent = '二维码生成失败，请复制下方链接。';
  }
  ui.qrRoomCode.textContent = `ROOM ${app.room}`;
  openDialog(ui.qrDialog);
}

function updateInviteText() {
  const link = buildInviteLink();
  ui.qrLinkText.textContent = link;
  ui.qrRoomCode.textContent = `ROOM ${app.room}`;
}

function buildInviteLink() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', app.room);
  return url.toString();
}

function openDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  document.body.classList.add('modal-open');
}

function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
  if (!document.querySelector('dialog[open]')) document.body.classList.remove('modal-open');
}

function openSummary() {
  if (!app.state) return;
  const derived = deriveLedger(app.state);
  const best = getBestBlock(app.state);
  const forks = app.state.blocks.filter((block) => !derived.canonicalIds.has(block.id));
  const attackCount = app.state.attackHistory?.length || 0;
  ui.summaryNumbers.innerHTML = `
    <div><strong>${best.height}</strong><span>主链高度</span></div>
    <div><strong>${derived.included.length}</strong><span>已确认交易</span></div>
    <div><strong>${forks.length}</strong><span>非主链区块</span></div>
    <div><strong>${attackCount}</strong><span>重组事故</span></div>
  `;
  const ranking = [...app.state.players]
    .map((player) => ({ ...player, balance: derived.accounts[player.address] ?? 0 }))
    .sort((a, b) => b.balance - a.balance);
  ui.summaryRanking.innerHTML = ranking.slice(0, 8).map((player) => `
    <li><b>${escapeHtml(player.name)}</b>：${formatNumber(player.balance)} CB <small>${escapeHtml(shortAddress(player.address))}</small></li>
  `).join('');
  const conclusions = [
    `所有节点最终停在同一条主链上；当前末端高度为 ${best.height}。`,
    derived.rejected.length
      ? `${derived.rejected.length} 笔交易因余额冲突或验证失败未进入主链。`
      : '本次没有出现余额冲突；可以再演示一次双花。',
    forks.length
      ? `账本保留过 ${forks.length} 个非主链区块，说明“出现过”与“最终被确认”不是一回事。`
      : '本次还没有制造同时出块；可在大屏的事故卡中演示分叉。',
    attackCount
      ? '51% 重组能改写交易顺序，但不能伪造未参与攻击节点的私钥签名。'
      : '尚未发动多数算力重组；可先标记逾半节点，再观察它能改变什么。',
    '课堂币是模拟值，没有市场价格，也不能兑换为真实资产。',
  ];
  ui.summaryConclusions.innerHTML = conclusions.map((text) => `<li>${escapeHtml(text)}</li>`).join('');
  openDialog(ui.summaryDialog);
}

function downloadLedger() {
  if (!app.state) return;
  const derived = deriveLedger(app.state);
  const labels = { pending: '待确认', included: '已确认', rejected: '已拒绝', orphaned: '分支失效' };
  const rows = [['时间', '付款节点', '付款地址', '收款节点', '收款地址', '金额CB', '费用CB', '状态', '区块高度', '交易ID']];
  [...app.state.txs].sort((a, b) => a.submittedAt - b.submittedAt).forEach((tx) => {
    const status = derived.txStatuses[tx.id] || {};
    rows.push([
      new Date(tx.submittedAt).toLocaleString('zh-CN'),
      tx.fromName,
      tx.fromAddress,
      tx.toName,
      tx.toAddress,
      tx.amount,
      tx.fee,
      labels[status.status] || status.status,
      status.blockId ? blockHeightById(status.blockId) : '',
      tx.id,
    ]);
  });
  const csv = '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `共识实验室-${app.room}-完整账本.csv`);
}

function copyLedger() {
  if (!app.state) return;
  const derived = deriveLedger(app.state);
  const labels = { pending: '待确认', included: '已确认', rejected: '已拒绝', orphaned: '分支失效' };
  const lines = [
    `共识实验室 ${app.room}｜主链高度 ${getBestBlock(app.state).height}｜节点 ${app.state.players.length}`,
    '',
    '财富排行',
    ...[...app.state.players]
      .map((p) => ({ ...p, balance: derived.accounts[p.address] ?? 0 }))
      .sort((a, b) => b.balance - a.balance)
      .map((p, index) => `${index + 1}. ${p.name} ${p.address} ${p.balance} CB`),
    '',
    '交易流水',
    ...app.state.txs.map((tx) => `${tx.fromName} -> ${tx.toName} ${tx.amount} CB｜${labels[derived.txStatuses[tx.id]?.status] || '待确认'}｜${tx.id}`),
  ];
  copyText(lines.join('\n'), '账本摘要已复制');
}

function togglePresentation() {
  const presenting = !document.body.classList.contains('presenting');
  document.body.classList.toggle('presenting', presenting);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (presenting) {
    showToast('已进入投影模式。按 Esc 或再次点击右上角图标退出。');
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  } else if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch (error) {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    showToast(successMessage);
  }
}

function showToast(message, isError = false) {
  clearTimeout(app.toastTimer);
  ui.toast.textContent = message;
  ui.toast.classList.toggle('error', isError);
  ui.toast.classList.add('show');
  app.toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 4200);
}

function showConfetti() {
  const colors = ['#c8ff4d', '#55e3c1', '#ffb85a', '#f5f7ef'];
  ui.confetti.innerHTML = '';
  for (let index = 0; index < 34; index += 1) {
    const bit = document.createElement('i');
    bit.style.left = `${2 + Math.random() * 96}%`;
    bit.style.background = colors[index % colors.length];
    bit.style.animationDelay = `${Math.random() * .35}s`;
    bit.style.setProperty('--drift', `${-90 + Math.random() * 180}px`);
    ui.confetti.appendChild(bit);
  }
  setTimeout(() => {
    ui.confetti.innerHTML = '';
  }, 2400);
}

async function createIdentity(name) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('浏览器不支持 Web Crypto，请使用较新的 Chrome、Edge 或 Safari');
  }
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pubKey = JSON.stringify({ kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y });
  const addressSeed = await sha256Hex(pubKey);
  return {
    id: `node_${randomToken(12)}`,
    name,
    address: `BL${addressSeed.slice(0, 10).toUpperCase()}`,
    pubKey,
    publicJwk,
    privateJwk,
  };
}

async function importPublicKey(pubKey) {
  const jwk = typeof pubKey === 'string' ? JSON.parse(pubKey) : pubKey;
  return crypto.subtle.importKey(
    'jwk',
    { ...jwk, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
}

async function importPrivateKey(privateJwk) {
  return crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function persistSession() {
  try {
    sessionStorage.setItem('consensus-lab-session', JSON.stringify({
      room: app.room,
      role: app.role,
      offline: app.offline,
      identity: app.identity,
      state: app.role === 'host' ? app.state : null,
      savedAt: Date.now(),
    }));
  } catch (error) {
    console.warn('Session persistence unavailable', error);
  }
}

async function restoreSession() {
  if (document.body.dataset.sessionChecked) return false;
  document.body.dataset.sessionChecked = 'true';
  try {
    const saved = JSON.parse(sessionStorage.getItem('consensus-lab-session') || 'null');
    if (!saved || !saved.room || !saved.identity || !saved.state) return false;
    if (Date.now() - Number(saved.savedAt || 0) > 6 * 60 * 60 * 1000) {
      sessionStorage.removeItem('consensus-lab-session');
      return false;
    }
    const incomingRoom = sanitizeRoom(new URLSearchParams(location.search).get('room') || '');
    if (incomingRoom && incomingRoom !== saved.room) return false;

    app.room = saved.room;
    app.role = saved.role === 'host' ? 'host' : 'guest';
    app.offline = Boolean(saved.offline);
    app.identity = saved.identity;
    app.state = saved.state;
    showGame();
    if (app.role === 'host') {
      showToast('已恢复当前标签页的课堂房间。');
      if (app.offline) {
        setConnectionStatus('offline', '离线单人模式 · 数据只保存在本页');
      } else {
        await connectSync(true);
      }
    } else {
      app.sync = createSyncClient();
      await app.sync.connect();
      sendHello();
      setConnectionStatus('ready', '已恢复学生节点 · 正在同步');
    }
    return true;
  } catch (error) {
    console.warn('Session restore failed', error);
    sessionStorage.removeItem('consensus-lab-session');
    return false;
  }
}

function randomToken(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join('');
}

function randomRoomCode() {
  return randomToken(6);
}

function sanitizeRoom(value) {
  const normalized = String(value || '').toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, '').slice(0, 8);
  return normalized.length >= 6 ? normalized : '';
}

function cleanName(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12);
}

function uniqueName(name, players) {
  if (!players.some((player) => player.name === name)) return name;
  let index = 2;
  while (players.some((player) => player.name === `${name.slice(0, 9)} ${index}`)) index += 1;
  return `${name.slice(0, 9)} ${index}`;
}

function validIdentifier(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{4,80}$/.test(value);
}

function addressFromSeed(seed) {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `BL${(hash >>> 0).toString(16).padStart(8, '0').toUpperCase()}${Date.now().toString(16).slice(-2).toUpperCase()}`;
}

function shortAddress(address) {
  if (!address) return '未知地址';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function shorten(value, start = 12, end = 8) {
  const text = String(value || '');
  if (text.length <= start + end + 1) return text;
  return `${text.slice(0, start)}…${text.slice(-end)}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function downloadBlob(blob, filename) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function friendlyError(error) {
  const message = String(error?.message || error || '未知错误');
  if (/timed out|timeout|等待大屏响应超时/i.test(message)) return '等待老师的大屏响应超时';
  if (/WebSocket|network|failed/i.test(message)) return '课堂中继连接失败';
  if (/secure|subtle|crypto/i.test(message)) return '当前浏览器无法生成签名密钥，请改用新版 Chrome 或 Edge';
  return message;
}

class MiniMqtt {
  constructor({ url, topic, clientId, onMessage, onStatus, onReady }) {
    this.url = url;
    this.topic = topic;
    this.clientId = clientId;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.onReady = onReady;
    this.ws = null;
    this.buffer = new Uint8Array(0);
    this.ready = false;
    this.active = false;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.connectResolver = null;
    this.connectRejecter = null;
    this.connectTimer = null;
  }

  connect() {
    if (this.ready) return Promise.resolve();
    this.active = true;
    this.onStatus?.('connecting', '正在连接课堂中继');
    return new Promise((resolve, reject) => {
      this.connectResolver = resolve;
      this.connectRejecter = reject;
      clearTimeout(this.connectTimer);
      this.connectTimer = setTimeout(() => {
        const error = new Error('WebSocket timeout');
        this.connectRejecter?.(error);
        this.connectRejecter = null;
        this.connectResolver = null;
        this.onStatus?.('error', '同步暂不可用');
        this.ws?.close();
      }, 12000);
      this.openSocket();
    });
  }

  openSocket() {
    clearTimeout(this.reconnectTimer);
    try {
      this.ws = new WebSocket(this.url, ['mqtt']);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => {
        this.onStatus?.('connecting', '握手成功，正在订阅房间');
        this.sendPacket(0x10, this.encodeConnectBody());
      };
      this.ws.onmessage = (event) => this.handleSocketMessage(event.data);
      this.ws.onerror = () => this.onStatus?.('error', '课堂中继连接异常');
      this.ws.onclose = () => {
        this.ready = false;
        clearInterval(this.pingTimer);
        if (this.active) {
          this.onStatus?.('error', '同步中断，正在自动重连');
          this.reconnectTimer = setTimeout(() => this.openSocket(), 3000);
        }
      };
    } catch (error) {
      this.onStatus?.('error', '课堂中继连接失败');
      this.connectRejecter?.(error);
    }
  }

  disconnect() {
    this.active = false;
    this.ready = false;
    clearInterval(this.pingTimer);
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.connectTimer);
    this.ws?.close();
    this.ws = null;
  }

  publish(object) {
    if (!this.ready) return false;
    const topicBytes = new TextEncoder().encode(this.topic);
    const payload = new TextEncoder().encode(JSON.stringify(object));
    const body = new Uint8Array(2 + topicBytes.length + payload.length);
    body[0] = topicBytes.length >> 8;
    body[1] = topicBytes.length & 0xff;
    body.set(topicBytes, 2);
    body.set(payload, 2 + topicBytes.length);
    this.sendPacket(0x30, body);
    return true;
  }

  encodeConnectBody() {
    const protocol = new TextEncoder().encode('MQTT');
    const client = new TextEncoder().encode(this.clientId.slice(0, 45));
    const body = new Uint8Array(2 + protocol.length + 4 + 2 + client.length);
    let offset = 0;
    body[offset++] = 0;
    body[offset++] = protocol.length;
    body.set(protocol, offset);
    offset += protocol.length;
    body[offset++] = 4;
    body[offset++] = 0x02;
    body[offset++] = 0;
    body[offset++] = 30;
    body[offset++] = client.length >> 8;
    body[offset++] = client.length & 0xff;
    body.set(client, offset);
    return body;
  }

  encodeSubscribeBody() {
    const topic = new TextEncoder().encode(this.topic);
    const body = new Uint8Array(2 + 2 + topic.length + 1);
    body[0] = 0;
    body[1] = 1;
    body[2] = topic.length >> 8;
    body[3] = topic.length & 0xff;
    body.set(topic, 4);
    body[4 + topic.length] = 0;
    return body;
  }

  sendPacket(typeAndFlags, body) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    const remaining = encodeRemainingLength(body.length);
    const packet = new Uint8Array(1 + remaining.length + body.length);
    packet[0] = typeAndFlags;
    packet.set(remaining, 1);
    packet.set(body, 1 + remaining.length);
    this.ws.send(packet);
    return true;
  }

  async handleSocketMessage(data) {
    let arrayBuffer;
    if (data instanceof Blob) arrayBuffer = await data.arrayBuffer();
    else if (data instanceof ArrayBuffer) arrayBuffer = data;
    else arrayBuffer = new Uint8Array(data).buffer;
    const incoming = new Uint8Array(arrayBuffer);
    const merged = new Uint8Array(this.buffer.length + incoming.length);
    merged.set(this.buffer);
    merged.set(incoming, this.buffer.length);
    this.buffer = merged;
    this.parsePackets();
  }

  parsePackets() {
    while (this.buffer.length >= 2) {
      const parsedLength = decodeRemainingLength(this.buffer, 1);
      if (!parsedLength) return;
      const totalLength = 1 + parsedLength.bytes + parsedLength.value;
      if (this.buffer.length < totalLength) return;
      const packetType = this.buffer[0];
      const packet = this.buffer.slice(1 + parsedLength.bytes, totalLength);
      this.buffer = this.buffer.slice(totalLength);
      this.handlePacket(packetType, packet);
    }
  }

  handlePacket(typeAndFlags, packet) {
    const type = (typeAndFlags & 0xf0) >> 4;
    if (type === 2) {
      const accepted = packet[1] === 0;
      if (!accepted) {
        this.connectRejecter?.(new Error('MQTT connection rejected'));
        return;
      }
      this.sendPacket(0x82, this.encodeSubscribeBody());
      return;
    }
    if (type === 9) {
      this.ready = true;
      clearTimeout(this.connectTimer);
      this.onStatus?.('ready', '课堂房间已连接');
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.sendPacket(0xc0, new Uint8Array(0)), 25000);
      this.connectResolver?.();
      this.connectResolver = null;
      this.connectRejecter = null;
      this.onReady?.();
      return;
    }
    if (type === 3) {
      const qos = (typeAndFlags & 0x06) >> 1;
      let offset = 0;
      const topicLength = (packet[offset] << 8) | packet[offset + 1];
      offset += 2;
      const topic = new TextDecoder().decode(packet.slice(offset, offset + topicLength));
      offset += topicLength;
      if (qos > 0) offset += 2;
      if (topic !== this.topic) return;
      try {
        const payload = new TextDecoder().decode(packet.slice(offset));
        this.onMessage?.(JSON.parse(payload));
      } catch (error) {
        console.warn('Ignored malformed relay message', error);
      }
    }
  }
}

function encodeRemainingLength(length) {
  const bytes = [];
  let value = length;
  do {
    let encoded = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) encoded |= 0x80;
    bytes.push(encoded);
  } while (value > 0);
  return Uint8Array.from(bytes);
}

function decodeRemainingLength(buffer, offset) {
  let multiplier = 1;
  let value = 0;
  let index = 0;
  while (offset + index < buffer.length) {
    const byte = buffer[offset + index];
    value += (byte & 0x7f) * multiplier;
    index += 1;
    if ((byte & 0x80) === 0) return { value, bytes: index };
    multiplier *= 128;
    if (index > 4) return null;
  }
  return null;
}
