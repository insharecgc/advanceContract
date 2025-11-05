const hre = require("hardhat");
const { expect, config } = require("chai");
const { ethers } = hre;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe("SHIBT (SHIM) Token", function () {
    this.timeout(600 * 1000); // 设置超时为10分钟

    let SHIBToken, memeToken;
    let owner, treasury, user1;
    let weth, router, factory, pairAddress, memeTokenAddress;
    let wethInPair, memeInPair;
    let tx;

    let routerAddress = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008"; // sepolia网上的router地址

    // 部署参数配置
    let tokenConfig = {
        name: "SHIB Style Meme",
        symbol: "SHIM",
        minLockLp: 30,  // 初始化：最小锁仓时间30秒（方便测试）
        adminDelay: 10, // 初始化：管理员修改税率延迟时间10秒（方便测试）

        // 测试参数
        buyTaxBps: 500, // 5% 买入税率
        sellTaxBps: 1200, // 12% 卖出税率
        minDelayBetweenTx: 10, // 10秒内禁止交易，最小10
    };

    beforeEach(async function () {
        [owner, treasury, user1] = await ethers.getSigners();
        console.log("Deploying contracts with the account:", owner.address);
        console.log("treasury, user1", treasury.address, user1.address);
        // // 部署 WETH 模拟合约
        // const WETH = await ethers.getContractFactory("WETH9");
        // weth = await WETH.deploy();
        // weth.waitForDeployment();
        // console.log("\nWETH 部署到:", weth.target);

        // // 部署 UniswapV2Factory
        // const Factory = await ethers.getContractFactory("UniswapV2Factory");
        // factory = await Factory.deploy();
        // factory.waitForDeployment();
        // console.log("UniswapV2Factory 部署到:", factory.target);

        // // 部署 UniswapV2Router02
        // const Router = await ethers.getContractFactory("UniswapV2Router02");
        // router = await Router.deploy(factory.target, weth.target);
        // router.waitForDeployment();
        // console.log("UniswapV2Router02 部署到:", router.target);
        // routerAddress = router.target;

        // console.log("\n⏳ 正在部署合约...");
        // console.log("代币名称:", tokenConfig.name);
        // console.log("代币符号:", tokenConfig.symbol);
        // console.log("国库地址:", treasury.address);

        // // 部署合约
        // SHIBToken = await ethers.getContractFactory("SHIBToken");
        // memeToken = await SHIBToken.deploy(
        //     tokenConfig.name,
        //     tokenConfig.symbol,
        //     treasury.address,
        //     routerAddress,
        //     tokenConfig.minLockLp,
        //     tokenConfig.adminDelay
        // );
        // await memeToken.waitForDeployment();
        // console.log("✅ 合约部署成功!");
        // memeTokenAddress = memeToken.target
        // console.log("📄 合约地址:", memeTokenAddress);  // 0x11eD09B441dFB9dcd2D18E87D67339F2752FbD2D，0x45dFd0efbAB2a4DE716A4393464c3Ce4DBa6d984
        
        /** -------------------------已经发布到Sepolia网了，这里不再重新发布，直接取合约地址------------------------- */
        memeTokenAddress = "0x11eD09B441dFB9dcd2D18E87D67339F2752FbD2D"; 
        SHIBToken = await ethers.getContractFactory("SHIBToken");
        memeToken = SHIBToken.attach(memeTokenAddress);
        console.log("📄 合约地址:", memeTokenAddress);
        // 获取WETH合约
        wethAddress = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"  // Sepolia上的WETH地址
        const WETHABI = [{"constant":true,"inputs":[],"name":"name","outputs":[{"name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"guy","type":"address"},{"name":"wad","type":"uint256"}],"name":"approve","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"totalSupply","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"src","type":"address"},{"name":"dst","type":"address"},{"name":"wad","type":"uint256"}],"name":"transferFrom","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[{"name":"wad","type":"uint256"}],"name":"withdraw","outputs":[],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":true,"inputs":[],"name":"decimals","outputs":[{"name":"","type":"uint8"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[{"name":"","type":"address"}],"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":true,"inputs":[],"name":"symbol","outputs":[{"name":"","type":"string"}],"payable":false,"stateMutability":"view","type":"function"},{"constant":false,"inputs":[{"name":"dst","type":"address"},{"name":"wad","type":"uint256"}],"name":"transfer","outputs":[{"name":"","type":"bool"}],"payable":false,"stateMutability":"nonpayable","type":"function"},{"constant":false,"inputs":[],"name":"deposit","outputs":[],"payable":true,"stateMutability":"payable","type":"function"},{"constant":true,"inputs":[{"name":"","type":"address"},{"name":"","type":"address"}],"name":"allowance","outputs":[{"name":"","type":"uint256"}],"payable":false,"stateMutability":"view","type":"function"},{"payable":true,"stateMutability":"payable","type":"fallback"},{"anonymous":false,"inputs":[{"indexed":true,"name":"src","type":"address"},{"indexed":true,"name":"guy","type":"address"},{"indexed":false,"name":"wad","type":"uint256"}],"name":"Approval","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"src","type":"address"},{"indexed":true,"name":"dst","type":"address"},{"indexed":false,"name":"wad","type":"uint256"}],"name":"Transfer","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"dst","type":"address"},{"indexed":false,"name":"wad","type":"uint256"}],"name":"Deposit","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"src","type":"address"},{"indexed":false,"name":"wad","type":"uint256"}],"name":"Withdrawal","type":"event"}];
        const provider = ethers.provider;
        weth = new ethers.Contract(wethAddress, WETHABI, provider);
        console.log("📄 WETH 地址:", weth.target);
        /** ---------------------------------------------------------------------------------------------------- */
        pairAddress = await memeToken.getUniswapPair();
        console.log("📄 Uniswap Pair 地址:", pairAddress);
    });

    // 已通过测试，注释
    // it("should config successfully", async function () {
    //     // 验证名单
    //     expect(await memeToken.isWhitelisted(routerAddress)).to.be.true;
    //     expect(await memeToken.isWhitelisted(pairAddress)).to.be.true;
    //     expect(await memeToken.isWhitelisted(memeTokenAddress)).to.be.true;
    //     const ownerAddress = await owner.getAddress();
    //     expect(await memeToken.isWhitelisted(ownerAddress)).to.be.true;

    //     // 验证免税地址
    //     expect(await memeToken.isTaxExempt(treasury.address)).to.be.true;
    //     expect(await memeToken.isTaxExempt(memeTokenAddress)).to.be.true;
    //     expect(await memeToken.isTaxExempt(ownerAddress)).to.be.true;

    //     // 提案修改税率
    //     console.log("\n⚙️ 提案修改税率...");
    //     let tx = await memeToken.proposeSetTaxBps(
    //         tokenConfig.buyTaxBps,
    //         tokenConfig.sellTaxBps,
    //         { gasLimit: 300000 } // 手动设置gas限制（根据实际消耗调整）
    //     );
    //     const receipt = await tx.wait();
    //     const provider = ethers.provider;
    //     const block = await provider.getBlock(receipt.blockNumber)
    //     console.log("交易区块时间：", block.timestamp.toString());
    //     let [buyTaxBps, sellTaxBps] = await memeToken.getTax()
    //     console.log("提案修改税率后，buyTaxBps:", buyTaxBps.toString(), "sellTaxBps:", sellTaxBps.toString());
    //     // 默认应该是500和1000
    //     expect(buyTaxBps.toString()).to.eq("500")
    //     expect(sellTaxBps.toString()).to.eq("1000")

    //     console.log("\n⏳ 延迟10秒,执行修改税率...");
    //     await sleep(10000);
    //     tx = await memeToken.executeSetTaxBps(
    //         tokenConfig.buyTaxBps,
    //         tokenConfig.sellTaxBps,
    //         block.timestamp
    //     );
    //     await tx.wait();
    //     console.log("✅ 执行提案修改税率完成");

    //     // 验证配置
    //     console.log("\n🔍 查询合约配置...");
    //     [buyTaxBps, sellTaxBps] = await memeToken.getTax()
    //     console.log("修改税率后，buyTaxBps:", buyTaxBps.toString(), "sellTaxBps:", sellTaxBps.toString());
    //     // 修改生效，税率应该是修改值
    //     expect(buyTaxBps.toString()).to.eq(tokenConfig.buyTaxBps.toString())
    //     expect(sellTaxBps.toString()).to.eq(tokenConfig.sellTaxBps.toString())

    //     console.log("\n⚙️ 修改交易间隔时间...");
    //     tx = await memeToken.setMinTxDelay(tokenConfig.minDelayBetweenTx)
    //     await tx.wait()
    //     const mindelayBetweenTx = await memeToken.getMinDelayBetweenTx()
    //     console.log("修改易间隔时间后，minDelayBetweenTx:", mindelayBetweenTx);
    //     // 修改生效，交易间隔应该是修改值
    //     expect(mindelayBetweenTx).to.eq(tokenConfig.minDelayBetweenTx)
    // });


    // 已通过测试，注释
    // it("Should initial liquidity successfully", async function () {
    //     // 初始添加流动性
    //     console.log("\n⚙️ 初始添加流动性...");
    //     // 获取交易前的 pair 余额
    //     const pairBalanceBefore = await memeToken.balanceOf(pairAddress);
    //     expect(pairBalanceBefore).to.equal(0, "Pair should have no tokens before liquidity added");
    //     const initialLiquidityMeme = ethers.parseEther("100000000000");   // 100亿SHIM == 0.001ETH
    //     const initialLiquidityEth = ethers.parseEther("0.001");
    //     // Owner 发送 ETH 给合约
    //     tx = await owner.sendTransaction({ to: memeTokenAddress, value: initialLiquidityEth });
    //     await tx.wait(3);
    //     const memTokenEth = await ethers.provider.getBalance(memeTokenAddress)
    //     console.log("📄 合约余额:", memTokenEth.toString());
    //     expect(memTokenEth).to.equal(initialLiquidityEth);
    //     // Owner 授权 Router 使用代币
    //     console.log("\n⚙️ 授权 Router 使用代币...");
    //     tx = await memeToken.approve(routerAddress, initialLiquidityMeme);
    //     await tx.wait(3);
    //     //调用合约的 addInitialLiquidity 函数，初始化流动性池
    //     console.log("\n⚙️ 添加流动性池...");
    //     tx = await memeToken.addInitialLiquidity(initialLiquidityMeme, initialLiquidityEth)
    //     await tx.wait(3);

    //     // 验证交易对余额
    //     const pairBalance = await memeToken.balanceOf(pairAddress);
    //     const wethInPair = await weth.balanceOf(pairAddress);
    //     console.log("pairMemeBalance:", pairBalance.toString(), "wethInPair:", wethInPair.toString());
    //     // expect(pairBalance).to.equal(initialLiquidityMeme); // 100亿SHIM
    //     // expect(wethInPair).to.equal(initialLiquidityEth);   // 0.001ETH

    //     // 验证合约余额清零
    //     expect(await memeToken.balanceOf(memeTokenAddress)).to.equal(0);
    //     expect(await ethers.provider.getBalance(memeTokenAddress)).to.equal(0);
    //     console.log("✅ 初始流动性完成");
    // });

    it("验证交易对上金额", async function () {
        const pairBalance = await memeToken.balanceOf(pairAddress);
        const wethInPair = await weth.balanceOf(pairAddress);
        console.log("pairMemeBalance:", pairBalance.toString(), "wethInPair:", wethInPair.toString());
    })

    // it("should collect 5% buy tax and send to contract when user buys from pair", async function () {
    //     const buyEthAmount = ethers.parseEther("0.0001"); // 用户1用 0.1 ETH 买入
    //     const path = [await router.WETH(), memeTokenAddress];
    //     const deadline = Math.floor(Date.now() / 1000) + 60*2 ; // 2分钟

    //     //用户1交易前，代币合约余额，用户代币余额，国库余额
    //     const contractBalanceBefore = await memeToken.balanceOf(memeTokenAddress);
    //     console.log("contractBalanceBefore:", contractBalanceBefore);
    //     const userBalanceBefore = await memeToken.balanceOf(user1.address);
    //     console.log("userBalanceBefore:", userBalanceBefore);
    //     const treasuryBalanceBefore = await memeToken.balanceOf(treasury.address);
    //     console.log("treasuryBalanceBefore:", treasuryBalanceBefore);

    //     // 用户（user1）通过 Router 买入代币
    //     const tx = await router.connect(user1).swapExactETHForTokens(
    //         0,
    //         path,
    //         user1.address,
    //         deadline,
    //         { value: buyEthAmount }
    //     );
    //     await tx.wait();
    //     console.log("第一次购买成功！");

    //     //等待 20 秒 (合约配置的交易间隔为20秒)
    //     await sleep(20000);

    //     //连续买两次
    //     const tx2 = await router.connect(user1).swapExactETHForTokens(
    //         0,
    //         path,
    //         user1.address,
    //         deadline,
    //         { value: buyEthAmount }
    //     );
    //     await tx2.wait();
    //     console.log("第二次购买成功！");

    //     //用户交易后，代币合约余额，用户代币余额，国库余额
    //     const contractBalanceAfter = await memeToken.balanceOf(await memeToken.getAddress());
    //     console.log("contractBalanceAfter:", contractBalanceAfter);
    //     const userBalanceAfter = await memeToken.balanceOf(user1.address);
    //     console.log("userBalanceAfter:", userBalanceAfter);
    //     const treasuryBalanceAfter = await memeToken.balanceOf(treasury.address);
    //     console.log("treasuryBalanceAfter:", treasuryBalanceAfter);

    //     //合约收到的税费
    //     const taxReceived = contractBalanceAfter - contractBalanceBefore;
    //     console.log("taxReceived:", taxReceived);

    //     //用户1收到的代币数
    //     const userReceived = userBalanceAfter - userBalanceBefore;
    //     console.log("userReceived:", userReceived);

    //     //验证合约收到的税费必须正好是 5%
    //     const taxReceivedFormatted = parseFloat(ethers.formatUnits(taxReceived, 18));
    //     const marketingReceivedFormatted = parseFloat(ethers.formatUnits(treasuryBalanceAfter, 18));
    //     const userReceivedFormatted = parseFloat(ethers.formatUnits(userReceived, 18));

    //     const totalTax = taxReceivedFormatted + marketingReceivedFormatted;
    //     const totalDistributed = userReceivedFormatted + totalTax;
    //     const realTaxRate = (totalTax / totalDistributed) * 100;

    //     console.log("realTaxRate:", realTaxRate);
    //     //expect(realTaxRate).to.equal((5n), "买入税率必须正好是 5%");
    //     expect(realTaxRate).to.be.closeTo(5, 0.1, "买入税率应在 5% ±0.1% 范围内");

    //     //获取交易后的 pair 余额
    //     await getPairLiquidity();
    //     console.log("buy after ETH (as WETH) in Pair:", ethers.formatEther(wethInPair), "WETH");
    //     console.log("buy after MEME in Pair:", ethers.formatUnits(memeInPair, 18), "SHIM");
    // }); 

});