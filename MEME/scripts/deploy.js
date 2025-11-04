const hre = require("hardhat");
const { ethers } = hre;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * SHIB风格Meme代币部署脚本
 * 部署合约并配置初始参数
 */

async function main() {
    console.log("🚀 开始部署SHIB风格Meme代币合约...");

    // 获取部署者账户
    const [deployer] = await ethers.getSigners();
    console.log("📝 部署者地址:", deployer.address);
    // console.log("💰 部署者余额:", ethers.formatEther(await deployer.getBalance()), "ETH");

    // Uniswap V2 Router 地址 (主网和测试网)
    const ROUTER_ADDRESSES = {
        mainnet: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
        sepolia: "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008",
        goerli: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
        polygon: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff",
        bsc: "0x10ED43C718714eb63d5aA57B78B54704E256024E"
    };

    const networkName = hre.network.name;
    console.log("当前网络:", networkName);

    let routerAddress;
    if (networkName === "localhost" || networkName === "hardhat") {
        // 本地测试网络，需要部署模拟路由
        console.log("检测到本地网络，将部署模拟路由合约...");

        // 部署 WETH 模拟合约
        const WETH = await ethers.getContractFactory("WETH9");
        const weth = await WETH.deploy();
        weth.waitForDeployment();
        console.log("WETH 部署到:", weth.target);

        // 部署 UniswapV2Factory
        const Factory = await ethers.getContractFactory("UniswapV2Factory");
        const factory = await Factory.deploy();
        factory.waitForDeployment();
        console.log("UniswapV2Factory 部署到:", factory.target);

        // 部署 UniswapV2Router02
        const Router = await ethers.getContractFactory("UniswapV2Router02");
        const router = await Router.deploy(factory.target, weth.target);
        router.waitForDeployment();
        console.log("UniswapV2Router02 部署到:", router.target);

        routerAddress = router.target;
    } else {
        routerAddress = ROUTER_ADDRESSES[networkName];
        if (!routerAddress) {
            throw new Error(`不支持的网络: ${networkName}`);
        }
    }
    console.log("使用路由地址:", routerAddress);

    // 部署参数配置
    const tokenConfig = {
        name: "SHIB Style Meme",
        symbol: "SHIM",
        treasuryWallet: deployer.address, // 使用部署者地址作为临时国库地址
        minLockLp: 30,  // 初始化：最小锁仓时间30秒（方便测试）
        adminDelay: 10, // 初始化：管理员修改税率延迟时间10秒（方便测试）

        // 测试参数
        buyTaxBps: 600, // 6% 买入税率
        sellTaxBps: 1200, // 12% 卖出税率
        minDelayBetweenTx: 20, // 20秒内禁止交易
        addWhiteAddr: "0x0405d109770350d2a26bd7874525945106e306cb", // 添加白名单地址
    };

    console.log("\n📋 部署配置:");
    console.log("代币名称:", tokenConfig.name);
    console.log("代币符号:", tokenConfig.symbol);
    console.log("国库地址:", tokenConfig.treasuryWallet);

    // 部署合约
    console.log("\n⏳ 正在部署合约...");
    const SHIBToken = await ethers.getContractFactory("SHIBToken");
    const token = await SHIBToken.deploy(
        tokenConfig.name,
        tokenConfig.symbol,
        tokenConfig.treasuryWallet,
        routerAddress,
        tokenConfig.minLockLp,
        tokenConfig.adminDelay
    );
    token.waitForDeployment();

    console.log("✅ 合约部署成功!");
    console.log("📄 合约地址:", token.target);  // 0x69767ED4926338e7c971eCFf6447Bc95b6E8fBE8

    // 提案修改税率
    console.log("\n⚙️ 提案修改税率...");
    const taxTx = await token.proposeSetTaxBps(
        tokenConfig.buyTaxBps,
        tokenConfig.sellTaxBps,
         { gasLimit: 300000 } // 手动设置gas限制（根据实际消耗调整）
    );
    const receipt = await taxTx.wait();
    console.log("交易确认区块号：", receipt.blockNumber);
    const provider = ethers.provider;
    const block = await provider.getBlock(receipt.blockNumber)
    console.log("交易区块时间：", block.timestamp.toString());
    let[buyTaxBps, sellTaxBps] = await token.getTax()
    console.log("提案修改税率后，buyTaxBps:", buyTaxBps.toString(), "sellTaxBps:", sellTaxBps.toString());

    console.log("⏳ 延迟10秒,执行修改税率...");
    await sleep(10000);
    const execTaxTx = await token.executeSetTaxBps(
        tokenConfig.buyTaxBps,
        tokenConfig.sellTaxBps,
        block.timestamp
    );
    await execTaxTx.wait();
    console.log("✅ 执行提案修改税率完成");
    [buyTaxBps, sellTaxBps] = await token.getTax()
    console.log("修改税率后，buyTaxBps:", buyTaxBps.toString(), "sellTaxBps:", sellTaxBps.toString());



    // 税收分配设置
    // console.log("📊 税收分配设置...");

    // console.log("✅ 税收分配设置完成");

    // // 设置交易限制
    // console.log("🛡️ 设置交易限制...");
    // const limitTx = await token.updateTradingRestrictions(
    //     tokenConfig.maxTransaction,
    //     tokenConfig.maxWallet,
    //     tokenConfig.cooldown
    // );
    // await limitTx.wait();
    // console.log("✅ 交易限制设置完成");

    // // 验证配置
    // console.log("\n🔍 验证合约配置...");

    // const actualTaxRate = await token.taxRate();
    // const actualLiquidityShare = await token.liquidityPoolShare();
    // const actualMaxTx = await token.maxTransactionAmount();

    // console.log("📊 实际税率:", actualTaxRate.toString(), "%");
    // console.log("💧 流动性分配:", actualLiquidityShare.toString(), "%");
    // console.log("📈 最大交易量:", ethers.utils.formatEther(actualMaxTx), "SSMT");

    // // 保存部署信息到文件
    // const deploymentInfo = {
    //     contractAddress: token.address,
    //     deployer: deployer.address,
    //     network: (await ethers.provider.getNetwork()).name,
    //     deploymentTime: new Date().toISOString(),
    //     config: tokenConfig
    // };

    // console.log("\n📁 部署信息已保存");
    // console.log("🌐 网络:", deploymentInfo.network);
    // console.log("⏰ 部署时间:", deploymentInfo.deploymentTime);

    // // 输出使用说明
    // console.log("\n🎯 部署完成！下一步操作:");
    // console.log("1. 将流动性池地址设置为合约的流动性池");
    // console.log("2. 将重要地址（如DEX路由器）排除在税收和限制之外");
    // console.log("3. 测试代币转账和税收功能");
    // console.log("4. 配置前端应用集成");

    // return deploymentInfo;
}

// 错误处理
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ 部署失败:", error);
        process.exit(1);
    });

// module.exports = { main };