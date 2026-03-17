# Runner 直连 + 加密通信方案

## 背景

当前 IM 聊天链路：前端 → Server → Runner，Server 对聊天请求仅做参数拼接和消息转发。优化目标：前端与 Runner 同网络时直连，减少延迟和 Server 负载。

## 架构总览

```
首次连接:
  前端 → Server（请求直连信息）→ 返回 runner 地址 + 公钥
  前端 → Runner（ECDH 握手）→ 建立加密直连

后续聊天:
  前端 ↔ Runner（对称加密，不经过 Server）

直连失败:
  前端 → Server → Runner（fallback 中转模式）
```

## 一、非对称加密 — Config 安全下发

### 1.1 Runner 注册阶段

```
Runner 启动:
  1. 生成 ECDH 密钥对（P-256 曲线）
  2. 连接 Server WebSocket /ws/runner
  3. 发送 { type: 'register', publicKey: <base64> }

Server 收到注册:
  1. 缓存 runner 公钥
  2. 用 runner 公钥 + ECDH 导出共享密钥
  3. 用共享密钥 AES-256-GCM 加密 RuntimeConfig（含 API Key）
  4. 发送 { type: 'config', encrypted: <base64>, serverPublicKey: <base64> }

Runner 收到 config:
  1. 用自己私钥 + serverPublicKey 导出共享密钥
  2. AES-256-GCM 解密得到 RuntimeConfig
  3. 缓存到内存（不落盘）
  4. 进程退出即销毁
```

### 1.2 Config 变更下发

```
用户修改 Provider / Model:
  Server 用缓存的 runner 公钥重新加密新 config
  发送 { type: 'config_update', encrypted: <base64> }
  Runner 解密更新内存缓存
```

## 二、前端直连 Runner

### 2.1 Runner 暴露直连端口

```
Runner 启动时:
  1. 除了连 Server 的 WS，额外开一个 HTTP/WS 端口（随机端口 :0）
  2. 注册时上报直连地址: { directUrl: 'ws://192.168.x.x:PORT' }
  3. Server 记录 runner 的 directUrl
```

### 2.2 前端请求直连信息

```
GET /api/workspaces/:id/runner-info
Response:
{
  directUrl: "ws://192.168.x.x:12345",
  runnerPublicKey: "<base64>",
  fallback: true  // 是否支持 fallback
}
```

### 2.3 ECDH 握手（前端 ↔ Runner）

```
前端:
  1. 生成临时 ECDH 密钥对
  2. 连接 runner directUrl
  3. 发送 { type: 'handshake', clientPublicKey: <base64>, token: <session-token> }

Runner:
  1. 验证 token（可选：向 Server 校验，或用 JWT 本地验证）
  2. 用 clientPublicKey + 自己私钥导出共享密钥（AES-256-GCM）
  3. 返回 { type: 'handshake_ok', runnerPublicKey: <base64> }

前端:
  1. 用 runnerPublicKey + 自己私钥导出同一共享密钥
  2. 后续所有消息用此对称密钥加解密
```

### 2.4 加密通信

```
发送消息:
  plaintext → AES-256-GCM encrypt(sharedKey, nonce) → { encrypted, nonce, tag }

接收消息:
  { encrypted, nonce, tag } → AES-256-GCM decrypt(sharedKey) → plaintext

nonce: 每条消息递增计数器（防重放）
```

## 三、直连失败 Fallback

### 3.1 失败检测

```
前端尝试直连 Runner:
  - WebSocket 连接超时（3s）→ fallback
  - 握手失败 → fallback
  - 连接中断 → 自动切换到 fallback

fallback 模式:
  - 回退到 Server 中转（现有链路）
  - 前端标记 { mode: 'relay' }
  - 后续消息走 Server WS
```

### 3.2 自动恢复

```
fallback 期间:
  - 定时尝试重新直连（每 30s）
  - 直连成功 → 切换回直连模式
  - 切换过程中不丢消息（drain + swap）
```

### 3.3 前端状态机

```
         ┌─────────────┐
         │   INIT       │
         └──────┬───────┘
                │ 请求 runner-info
                ▼
         ┌─────────────┐
    ┌───►│  CONNECTING  │ （尝试直连）
    │    └──────┬───────┘
    │           │
    │    成功    │    失败/超时
    │    ▼      │      ▼
    │  ┌────────┐  ┌─────────┐
    │  │ DIRECT │  │ RELAY   │ （Server 中转）
    │  └────────┘  └────┬────┘
    │                   │ 定时重试
    └───────────────────┘
```

## 四、安全考量

| 威胁 | 防护 |
|------|------|
| WS 中间人截获 API Key | ECDH + AES-256-GCM 端到端加密 |
| Runner 进程内存 dump | 密钥不落盘，进程退出即销毁 |
| 重放攻击 | nonce 递增计数器 |
| 伪造 Runner | Server 注册时验证 RUNNER_SECRET |
| 伪造前端直连 | 握手时携带 session token，Runner 验证 |
| 直连端口暴露 | 只监听内网地址，不绑 0.0.0.0 |

## 五、实施步骤

1. **Phase 1: 加密 Config 下发**
   - Runner 注册带公钥
   - Server 加密 config
   - Runner 解密缓存

2. **Phase 2: Runner 直连端口**
   - Runner 开 HTTP/WS 直连端口
   - 上报 directUrl
   - 前端获取 runner-info API

3. **Phase 3: ECDH 握手 + 加密通信**
   - 前端 Web Crypto API 生成密钥
   - 握手协议实现
   - AES-256-GCM 消息加解密

4. **Phase 4: Fallback + 自动恢复**
   - 连接状态机
   - 超时检测 + 切换
   - 定时重试 + 无缝切换
