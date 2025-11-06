## 环境准备

### 1. 依赖安装

```bash
# 安装 Node.js 依赖
npm install --save-dev @openzeppelin/contracts 
npm install --save-dev @openzeppelin/contracts-upgradeable
npm install --save-dev @nomicfoundation/hardhat-ethers@3.0.0
npm install --save-dev @openzeppelin/hardhat-upgrades
npm install --save-dev hardhat-deploy
npm install --save-dev ethers
npm install --save-dev solidity-coverage
```

# 运行测试：
```bash
npx hardhat test
```

# 生成覆盖率报告：
```bash
npx hardhat coverage
```