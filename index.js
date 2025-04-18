// === FILE: index.js ===
const fs = require('fs');
const path = require('path');
const os = require('os');
const ethers = require('ethers');
const csv = require('csv-parser');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const PROVIDER_URL = process.env.RPC_URL;
const TEA_AMOUNT = ethers.parseEther(process.env.TEA_AMOUNT || '0.001');
const TRANSAKSI_PER_HARI = parseInt(process.env.TOTAL_TX_PER_DAY || '200', 10);
const CSV_PATH = './tea.csv';
const PORT = process.env.PORT || 3000;
const ABI_PATH = './erc20-abi.json';
const BYTECODE_PATH = './erc20-bytecode.json';
const TOKEN_INFO_PATH = './token.json';

const DELAY_MS = Math.floor((24 * 60 * 60 * 1000) / TRANSAKSI_PER_HARI);
let isPaused = false;

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

let transactionsSent = 0;
let addresses = [];
let tokenAddress = null;
let tokenName = null;
let tokenBalance = '-';

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const config of iface) {
      if (config.family === 'IPv4' && !config.internal) {
        return config.address;
      }
    }
  }
  return 'localhost';
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function saveTokenInfo(address, name) {
  fs.writeFileSync(TOKEN_INFO_PATH, JSON.stringify({ address, name, date: new Date().toISOString().slice(0, 10) }, null, 2));
}

function loadTokenInfo() {
  if (fs.existsSync(TOKEN_INFO_PATH)) {
    const data = JSON.parse(fs.readFileSync(TOKEN_INFO_PATH, 'utf8'));
    const today = new Date().toISOString().slice(0, 10);
    if (data.date === today) {
      tokenAddress = data.address;
      tokenName = data.name;
      return true;
    }
  }
  return false;
}

function loadCSV() {
  return new Promise((resolve, reject) => {
    const result = [];
    fs.createReadStream(CSV_PATH)
      .pipe(csv())
      .on('data', (row) => result.push(row.wallet || row.address || Object.values(row)[0]))
      .on('end', () => {
        addresses = result.slice(0, TRANSAKSI_PER_HARI);
        resolve();
      })
      .on('error', reject);
  });
}

async function deployTokenIfNeeded() {
  if (loadTokenInfo()) {
    io.emit('log', `🪙 Token hari ini sudah ada: <b>${tokenName}</b>`);
    return tokenAddress;
  }
  const abi = JSON.parse(fs.readFileSync(ABI_PATH, 'utf8'));
  const bytecodeJson = JSON.parse(fs.readFileSync(BYTECODE_PATH, 'utf8'));
  const bytecode = bytecodeJson.bytecode;
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const initialSupply = ethers.parseUnits("1000000", 18);
  const contract = await factory.deploy(initialSupply);
  io.emit('log', `🚀 Deploying ERC20 token...`);
  await contract.waitForDeployment();
  tokenAddress = await contract.getAddress();
  tokenName = await contract.name();
  saveTokenInfo(tokenAddress, tokenName);
  io.emit('log', `✅ Token <b>${tokenName}</b> deployed: <a href="https://sepolia.tea.xyz/address/${tokenAddress}" target="_blank">${tokenAddress}</a>`);
  return tokenAddress;
}

async function emitStatus() {
  try {
    // Tes koneksi dulu
    await provider.getBlockNumber();
    let balance = await provider.getBalance(wallet.address);
    rpcStatus = true;

    if (tokenAddress) {
      try {
        const abi = JSON.parse(fs.readFileSync(ABI_PATH, 'utf8'));
        const token = new ethers.Contract(tokenAddress, abi, provider);
        const raw = await token.balanceOf(wallet.address);
        tokenBalance = ethers.formatUnits(raw, 18);
      } catch (e) {
        tokenBalance = 'error';
      }
    }

    const totalTxCount = await provider.getTransactionCount(wallet.address);

    io.emit('status', {
      status: isPaused ? '⏸ Dijeda' : '🔘 Aktif',
      transactionsDone: transactionsSent,
      totalTx: TRANSAKSI_PER_HARI,
      totalAllTime: totalTxCount,
      countdown: getCountdown(),
      delayEachTx: Math.floor(DELAY_MS / 1000),
      balance: ethers.formatEther(balance),
      deployedTokenAddress: tokenAddress,
      tokenName,
      tokenBalance,
      mode: `TEA + ${tokenName}`,
      isPaused,
      rpcStatus
    });
  } catch (e) {
    // RPC gagal atau mati
    rpcStatus = false;
    io.emit('status', {
      status: '🔌 RPC MATI',
      transactionsDone: transactionsSent,
      totalTx: TRANSAKSI_PER_HARI,
      totalAllTime: '-',
      countdown: '--:--:--',
      delayEachTx: '-',
      balance: '-',
      deployedTokenAddress: tokenAddress,
      tokenName,
      tokenBalance: '-',
      mode: '-',
      isPaused,
      rpcStatus
    });
    io.emit('log', `⚠️ Tidak bisa akses RPC: ${e.message}`);
  }
}


function getCountdown() {
  if (isPaused) return '--:--:--';
  const now = Date.now();
  const nextTx = DELAY_MS - (now % DELAY_MS);
  const seconds = Math.floor(nextTx / 1000);
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `00:${m}:${s}`;
}

function getNextMidnight() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(17, 0, 0, 0);
  if (now >= next) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

async function sendTransaction(to) {
  try {
    const txNumber = transactionsSent + 1;
    const tx = await wallet.sendTransaction({ to, value: TEA_AMOUNT });
    const sentTime = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });
    io.emit('log', `📩 [${txNumber}] Mengirim ${ethers.formatEther(TEA_AMOUNT)} TEA ke ${to}...`);
    await tx.wait();
    io.emit('log', `✅ [${txNumber}] Terkirim ke ${to} | Hash: <a href="https://sepolia.tea.xyz/tx/${tx.hash}" target="_blank">${tx.hash}</a> | Waktu: ${sentTime}`);
  } catch (err) {
    io.emit('log', `❌ Gagal kirim TEA ke ${to}: ${err.message}`);
  }
}

async function sendTokenERC20(to) {
  try {
    const abi = JSON.parse(fs.readFileSync(ABI_PATH, 'utf8'));
    const contract = new ethers.Contract(tokenAddress, abi, wallet);
    const amount = ethers.parseUnits("10", 18);
    const txNumber = transactionsSent + 1;
    io.emit('log', `🪙 [${txNumber}] Kirim ${tokenName} ke ${to}...`);
    const tx = await contract.transfer(to, amount);
    await tx.wait();
    io.emit('log', `✅ [${txNumber}] Token ${tokenName} terkirim ke ${to} | <a href="https://sepolia.tea.xyz/tx/${tx.hash}" target="_blank">tx hash</a>`);
  } catch (err) {
    io.emit('log', `❌ Gagal kirim token ke ${to}: ${err.message}`);
  }
}

async function startLoop() {
  await loadCSV();
  await deployTokenIfNeeded();
  await emitStatus();

  let index = 0;
  let nextReset = getNextMidnight();

  setInterval(async () => {
    if (isPaused || index >= addresses.length || transactionsSent >= TRANSAKSI_PER_HARI) return;

    const now = new Date();
    if (now >= nextReset) {
      transactionsSent = 0;
      index = 0;
      nextReset = getNextMidnight();
      io.emit('log', `🔁 Reset harian.`);
      await deployTokenIfNeeded();
      await emitStatus();
    }

    const nowMs = Date.now();
    const shouldSendNow = nowMs % DELAY_MS < 1000;
    if (shouldSendNow) {
      const to = addresses[index++];
      try {
        await sendTransaction(to);
        await delay(500); // delay singkat untuk nonce bergantian
        await sendTokenERC20(to);
        transactionsSent++;
        await emitStatus();
      } catch (err) {
        io.emit('log', `❌ Error saat kirim ke ${to}: ${err.message}`);
      }
    }
  }, 1000);

  setInterval(() => emitStatus(), 1000);
}

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

app.post('/pause', (req, res) => {
  isPaused = true;
  io.emit('log', '⏸ Bot dijeda oleh user.');
  emitStatus();
  res.send('⏸ Bot dijeda.');
});

app.post('/resume', (req, res) => {
  isPaused = false;
  io.emit('log', '▶️ Bot dilanjutkan oleh user.');
  emitStatus();
  res.send('▶️ Bot dilanjutkan.');
});

io.on('connection', () => emitStatus());

server.listen(PORT, () => {
  const ip = getLocalIP();
  console.log(`🌐 Dashboard: http://${ip}:${PORT}`);
  startLoop();
});
