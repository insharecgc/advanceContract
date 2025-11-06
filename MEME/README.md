# advanceContract 操作指南


## 概述

本指南详细说明如何部署和使用 SHIB 风格的 MEME 代币合约。该合约实现了代币税机制、流动性池集成和交易限制功能。


## 环境准备

### 1. 依赖安装

```bash
# 安装 hardhat，本实例使用的2.27.0版本
npm install hardhat@2.27.0

# 初始化hardhat项目
npx hardhat init

# 安装 Node.js 依赖
npm install --save-dev @openzeppelin/contracts @nomicfoundation/hardhat-ethers@3.0.0 hardhat-deploy ethers

# 安装 Uniswap 依赖（用于本地测试）
npm install --save-dev @uniswap/v2-core @uniswap/v2-periphery

# package.json已经指定了依赖，直接执行以下命令即可（上面都不需要执行了）
npm install
```

### 2. 配置文件

创建 `hardhat.config.js`:

```javascript
require("@nomicfoundation/hardhat-toolbox");
require("@nomicfoundation/hardhat-ethers");
require('hardhat-deploy');
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545"
    },
    sepolia: {
      url: `https://sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`,
      accounts: [process.env.PRIVATE_KEY1, process.env.PRIVATE_KEY2, process.env.PRIVATE_KEY3, process.env.PRIVATE_KEY4]
    }
  }
};
```

### 3. 环境变量

创建 `.env` 文件（里面内容需要替换为对应的正确key，准备4个账户，别人填入4个账户的秘钥）:

```bash
INFURA_API_KEY=infura_api_key
PRIVATE_KEY1=private_key1
PRIVATE_KEY2=private_key2
PRIVATE_KEY3=private_key3
PRIVATE_KEY4=private_key4
```

## 合约部署

### 1. 本地部署（本地测试无法校验交易）

```bash
# 启动本地网络
npx hardhat node

# 在另一个终端中部署合约
npx hardhat run scripts/deploy.js --network localhost

# 在另一个终端中测试合约
npx hardhat test test/SHIBToken.test.js --network localhost
```

### 2. 测试网部署

```bash
# 部署到 Sepolia 测试网
npx hardhat run scripts/deploy.js --network Sepolia

# 验证合约
npx hardhat test test/SHIBToken.test.js --network sepolia
```