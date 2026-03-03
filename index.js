const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const net = require('net');

const PORT = process.argv[2] ? parseInt(process.argv[2], 10) : 3000;
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

let csProcess = null;
let csPort = null;
let currentWorkspace = '';
let status = 'stopped'; // stopped, starting, running, error
let logs = [];

// 获取空闲端口
function getFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, '127.0.0.1', () => {
            const port = srv.address().port;
            srv.close((err) => {
                if (err) reject(err);
                else resolve(port);
            });
        });
    });
}

// 启动 IDE
app.post('/api/start', async (req, res) => {
    // 如果已经在运行，且工作区没变，直接返回成功
    if (status === 'running' || status === 'starting') {
        return res.json({ status, port: csPort });
    }

    // 获取前端传来的路径，如果为空则默认为用户主目录
    let { workspacePath } = req.body;
    if (!workspacePath || typeof workspacePath !== 'string' || workspacePath.trim() === '') {
        workspacePath = os.homedir();
    }

    // 简单校验路径是否存在
    if (!fs.existsSync(workspacePath)) {
        return res.status(400).json({ error: `路径不存在: ${workspacePath}` });
    }

    status = 'starting';
    currentWorkspace = workspacePath;
    logs.push('Initialize IDE environment...');
    
    try {
        csPort = await getFreePort();
        
        const entryPath = path.join(__dirname, 'node_modules', 'code-server', 'out', 'node', 'entry.js');

        const args = [
            entryPath,
            '--port', csPort.toString(),
            '--auth', 'none',
            '--disable-telemetry',
            '--bind-addr', `127.0.0.1:${csPort}`,
            currentWorkspace // 将路径作为参数传入
        ];

        logs.push(`Starting code-server on 127.0.0.1:${csPort}...`);
        logs.push(`Workspace Target: ${currentWorkspace}`);

        csProcess = spawn(process.execPath, args);

        csProcess.stdout.on('data', (data) => {
            const text = data.toString().trim();
            if (text) {
                logs.push(text);
                if (logs.length > 50) logs.shift();
            }
            if (text.includes('HTTP server listening')) status = 'running';
        });

        csProcess.stderr.on('data', (data) => {
            const text = data.toString().trim();
            // 过滤掉一些无关紧要的 info 日志
            if (text) {
                logs.push(text);
                if (logs.length > 50) logs.shift();
            }
            if (text.includes('HTTP server listening')) status = 'running';
        });

        csProcess.on('close', (code) => {
            status = 'stopped';
            csProcess = null;
            csPort = null;
            logs.push(`Process exited with code ${code}`);
        });

        res.json({ status: 'starting' });
    } catch (err) {
        status = 'error';
        logs.push(`Failed to start: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/stop', (req, res) => {
    if (csProcess) {
        csProcess.kill();
        logs.push('Stopping IDE...');
    }
    status = 'stopped';
    res.json({ status });
});

app.get('/api/status', (req, res) => {
    // 增加返回 defaultHome 供前端默认填充
    res.json({ 
        status, 
        port: csPort, 
        logs: logs.slice(-20),
        defaultHome: os.homedir(), 
        currentWorkspace 
    });
});

app.listen(PORT, '127.0.0.1', () => console.log(`IDE Controller ready on ${PORT}`));