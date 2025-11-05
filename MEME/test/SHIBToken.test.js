const hre = require("hardhat");
const { expect, config } = require("chai");
const { ethers } = hre;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe("SHIBT (SHIM) Token", function () {
    let SHIBToken, memeToken;
    let owner, user1, user2;
    let weth, router, routerAddress, factory, pairAddress, memeTokenAddress;
    let wethInPair, memeInPair;

    // 部署参数配置
    let tokenConfig = {
        name: "SHIB Style Meme",
        symbol: "SHIM",
        treasuryWallet: "0x",
        minLockLp: 30,  // 初始化：最小锁仓时间30秒（方便测试）
        adminDelay: 10, // 初始化：管理员修改税率延迟时间10秒（方便测试）

        // 测试参数
        buyTaxBps: 600, // 6% 买入税率
        sellTaxBps: 1200, // 12% 卖出税率
        minDelayBetweenTx: 10, // 10秒内禁止交易，最小10
    };

    beforeEach(async function () {
        [owner, user1, user2] = await ethers.getSigners();
        console.log("Deploying contracts with the account:", owner.address);
        console.log("user1, user2", user1.address, user2.address);
        tokenConfig.treasuryWallet = user1.address;
        // 部署 WETH 模拟合约
        const WETH = await ethers.getContractFactory("WETH9");
        weth = await WETH.deploy();
        weth.waitForDeployment();
        console.log("\nWETH 部署到:", weth.target);

        // 部署 UniswapV2Factory
        const Factory = await ethers.getContractFactory("UniswapV2Factory");
        factory = await Factory.deploy();
        factory.waitForDeployment();
        console.log("UniswapV2Factory 部署到:", factory.target);

        // 部署 UniswapV2Router02
        const Router = await ethers.getContractFactory("UniswapV2Router02");
        router = await Router.deploy(factory.target, weth.target);
        router.waitForDeployment();
        console.log("UniswapV2Router02 部署到:", router.target);
        routerAddress = router.target;

        console.log("\n⏳ 正在部署合约...");
        console.log("代币名称:", tokenConfig.name);
        console.log("代币符号:", tokenConfig.symbol);
        console.log("国库地址:", tokenConfig.treasuryWallet);

        // 部署合约
        SHIBToken = await ethers.getContractFactory("SHIBToken");
        memeToken = await SHIBToken.deploy(
            tokenConfig.name,
            tokenConfig.symbol,
            tokenConfig.treasuryWallet,
            routerAddress,
            tokenConfig.minLockLp,
            tokenConfig.adminDelay
        );
        memeToken.waitForDeployment();

        console.log("✅ 合约部署成功!");
        console.log("📄 合约地址:", memeToken.target);  // 0x69767ED4926338e7c971eCFf6447Bc95b6E8fBE8
        memeTokenAddress = memeToken.target
    });

    it("should config successfully", async function () {
        // 提案修改税率
        console.log("\n⚙️ 提案修改税率...");
        let tx = await memeToken.proposeSetTaxBps(
            tokenConfig.buyTaxBps,
            tokenConfig.sellTaxBps,
            { gasLimit: 300000 } // 手动设置gas限制（根据实际消耗调整）
        );
        const receipt = await tx.wait();
        const provider = ethers.provider;
        const block = await provider.getBlock(receipt.blockNumber)
        console.log("交易区块时间：", block.timestamp.toString());
        let [buyTaxBps, sellTaxBps] = await memeToken.getTax()
        console.log("提案修改税率后，buyTaxBps:", buyTaxBps.toString(), "sellTaxBps:", sellTaxBps.toString());
        // 默认应该是500和1000
        expect(buyTaxBps.toString()).to.eq("500")
        expect(sellTaxBps.toString()).to.eq("1000")

        console.log("\n⏳ 延迟10秒,执行修改税率...");
        await sleep(10000);
        tx = await memeToken.executeSetTaxBps(
            tokenConfig.buyTaxBps,
            tokenConfig.sellTaxBps,
            block.timestamp
        );
        await tx.wait();
        console.log("✅ 执行提案修改税率完成");

        // 验证配置
        console.log("\n🔍 查询合约配置...");
        [buyTaxBps, sellTaxBps] = await memeToken.getTax()
        console.log("修改税率后，buyTaxBps:", buyTaxBps.toString(), "sellTaxBps:", sellTaxBps.toString());
        // 修改生效，税率应该是修改值
        expect(buyTaxBps.toString()).to.eq(tokenConfig.buyTaxBps.toString())
        expect(sellTaxBps.toString()).to.eq(tokenConfig.sellTaxBps.toString())

        console.log("\n⚙️ 修改交易间隔时间...");
        tx = await memeToken.setMinTxDelay(tokenConfig.minDelayBetweenTx)
        await tx.wait()
        const mindelayBetweenTx = await memeToken.getMinDelayBetweenTx()
        console.log("修改易间隔时间后，minDelayBetweenTx:", mindelayBetweenTx);
        // 修改生效，交易间隔应该是修改值
        expect(mindelayBetweenTx).to.eq(tokenConfig.minDelayBetweenTx)
    });


    it("Should initial liquidity successfully", async function () {

    });

    it("Should transfer successfully", async function () {

    });

});