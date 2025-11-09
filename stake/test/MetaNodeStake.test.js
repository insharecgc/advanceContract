const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("MetaNodeStake", function () {
    this.timeout(600 * 1000); // 设置超时为10分钟
    // 测试账户
    let owner, admin, user1, user2, nonAdmin;
    // 合约实例
    let metaNodeToken, stakeToken, metaNodeStake;
    // 常量
    const ETH_PID = 0;
    const ERC20_POOL_PID = 1;
    const START_BLOCK = 1000;
    const END_BLOCK = 100000;
    const META_NODE_PER_BLOCK = ethers.parseEther("10");
    const POOL_WEIGHT = 100;
    const MIN_DEPOSIT = ethers.parseEther("1");
    const UNSTAKE_LOCKED_BLOCKS = 10;
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

    // 部署前置准备
    beforeEach(async function () {
        // 获取测试账户
        [owner, admin, user1, user2, nonAdmin] = await ethers.getSigners();

        // 部署测试用ERC20代币（MetaNode）
        const MockERC20Token = await ethers.getContractFactory("MockERC20");
        metaNodeToken = await MockERC20Token.deploy("MetaNode", "MN");
        await metaNodeToken.waitForDeployment();
        console.log("奖励代币合约地址:", metaNodeToken.target);

        stakeToken = await MockERC20Token.deploy("StakeToken", "ST");
        await stakeToken.waitForDeployment();
        console.log("质押代币合约地址:", stakeToken.target);

        // 部署可升级合约MetaNodeStake
        const MetaNodeStake = await ethers.getContractFactory("MetaNodeStake");
        metaNodeStake = await upgrades.deployProxy(
            MetaNodeStake,
            [
                metaNodeToken.target,
                START_BLOCK,
                END_BLOCK,
                META_NODE_PER_BLOCK
            ],
            { initializer: "initialize" }
        );
        await metaNodeStake.waitForDeployment();
        console.log("MetaNodeStake合约地址:", metaNodeStake.target);

        // 授予admin角色（owner默认拥有所有角色）
        await metaNodeStake.grantRole(await metaNodeStake.ADMIN_ROLE(), admin.address);
        await metaNodeStake.grantRole(await metaNodeStake.UPGRADE_ROLE(), admin.address);

        //  mint 奖励代币到合约（供领取测试）
        await metaNodeToken.mint(metaNodeStake.target, ethers.parseEther("10000000"));

        // 快进区块到START_BLOCK（模拟正常运行场景）
        await mineBlocks(START_BLOCK);
    });

    // ============================== 初始化测试 ==============================
    describe("Initialization", function () {
        it("should set initial parameters correctly", async function () {
            const mateNode = await metaNodeStake.MetaNode()
            expect(mateNode).to.equal(metaNodeToken.target);
            expect(await metaNodeStake.startBlock()).to.equal(START_BLOCK);
            expect(await metaNodeStake.endBlock()).to.equal(END_BLOCK);
            expect(await metaNodeStake.MetaNodePerBlock()).to.equal(META_NODE_PER_BLOCK);
            expect(await metaNodeStake.withdrawPaused()).to.be.false;
            expect(await metaNodeStake.claimPaused()).to.be.false;
        });

        it("should grant roles to deployer", async function () {
            const adminRole = await metaNodeStake.ADMIN_ROLE();
            const upgradeRole = await metaNodeStake.UPGRADE_ROLE();
            expect(await metaNodeStake.hasRole(adminRole, owner.address)).to.be.true;
            expect(await metaNodeStake.hasRole(upgradeRole, owner.address)).to.be.true;
        });

    });

    // ============================== 管理员函数测试 ==============================
    describe("Admin Functions", function () {
        // 测试设置MetaNode代币
        it("should set MetaNode token correctly", async function () {
            const NewMetaNode = await ethers.getContractFactory("MockERC20");
            const newMetaNode = await NewMetaNode.deploy("NewMetaNode", "NMN");
            await newMetaNode.waitForDeployment();

            await expect(metaNodeStake.connect(nonAdmin).setMetaNode(newMetaNode.target))
                .to.be.reverted

            let tx = await metaNodeStake.connect(admin).setMetaNode(newMetaNode.target);
            await tx.wait()
            expect(await metaNodeStake.MetaNode()).to.equal(newMetaNode.target);
        });

        // 测试暂停/解除暂停提取功能
        it("should pause/unpause withdraw correctly", async function () {
            await expect(metaNodeStake.connect(nonAdmin).pauseWithdraw())
                .to.be.reverted;

            let tx = await metaNodeStake.connect(admin).pauseWithdraw();
            await tx.wait();
            expect(await metaNodeStake.withdrawPaused()).to.be.true;
            await expect(metaNodeStake.connect(admin).pauseWithdraw())
                .to.be.revertedWith("withdraw has been already paused");

            tx = await metaNodeStake.connect(admin).unpauseWithdraw();
            await tx.wait();
            expect(await metaNodeStake.withdrawPaused()).to.be.false;
            await expect(metaNodeStake.connect(admin).unpauseWithdraw())
                .to.be.revertedWith("withdraw has been already unpaused");
        });

        // 测试暂停/解除暂停领取功能
        it("should pause/unpause claim correctly", async function () {
            await expect(metaNodeStake.connect(nonAdmin).pauseClaim())
                .to.be.reverted;

            let tx = await metaNodeStake.connect(admin).pauseClaim();
            await tx.wait();
            expect(await metaNodeStake.claimPaused()).to.be.true;
            await expect(metaNodeStake.connect(admin).pauseClaim())
                .to.be.revertedWith("claim has been already paused");

            tx = await metaNodeStake.connect(admin).unpauseClaim();
            await tx.wait();
            expect(await metaNodeStake.claimPaused()).to.be.false;
            await expect(metaNodeStake.connect(admin).unpauseClaim())
                .to.be.revertedWith("claim has been already unpaused");
        });

        // 测试设置开始/结束区块
        it("should set start/end block correctly", async function () {
            await expect(metaNodeStake.connect(admin).setStartBlock(END_BLOCK + 1))
                .to.be.revertedWith("start block must be smaller than end block");

            await expect(metaNodeStake.connect(admin).setEndBlock(START_BLOCK - 1))
                .to.be.revertedWith("start block must be smaller than end block");

            const newStartBlock = 1500;
            await expect(metaNodeStake.connect(nonAdmin).setStartBlock(newStartBlock))
                .to.be.reverted;

            let tx = await metaNodeStake.connect(admin).setStartBlock(newStartBlock);
            await tx.wait();
            expect(await metaNodeStake.startBlock()).to.equal(newStartBlock);

            const newEndBlock = 15000;
            tx = await metaNodeStake.connect(admin).setEndBlock(newEndBlock);
            await tx.wait();
            expect(await metaNodeStake.endBlock()).to.equal(newEndBlock);
        });

        // 测试设置每区块奖励
        it("should set MetaNode per block correctly", async function () {
            await expect(metaNodeStake.connect(admin).setMetaNodePerBlock(0))
                .to.be.revertedWith("invalid parameter");
            const newPerBlock = ethers.parseEther("20");
            await expect(metaNodeStake.connect(nonAdmin).setMetaNodePerBlock(newPerBlock))
                .to.be.reverted;
            let tx = await metaNodeStake.connect(admin).setMetaNodePerBlock(newPerBlock);
            await tx.wait();
            expect(await metaNodeStake.MetaNodePerBlock()).to.equal(newPerBlock);
        });

        // 测试添加池（ETH池+ERC20池）
        it("should add pool correctly", async function () {
            // 添加首个池（ETH池）
            await metaNodeStake.connect(admin).addPool(
                ZERO_ADDRESS,
                POOL_WEIGHT,
                MIN_DEPOSIT,
                UNSTAKE_LOCKED_BLOCKS,
                false
            );
            expect(await metaNodeStake.poolLength()).to.equal(1);
            const ethPool = await metaNodeStake.pool(ETH_PID);
            expect(ethPool.stTokenAddress).to.equal(ZERO_ADDRESS);
            expect(ethPool.poolWeight).to.equal(POOL_WEIGHT);
            expect(ethPool.minDepositAmount).to.equal(MIN_DEPOSIT);
            expect(ethPool.unstakeLockedBlocks).to.equal(UNSTAKE_LOCKED_BLOCKS);

            // 添加ERC20池
            await metaNodeStake.connect(admin).addPool(
                stakeToken.target,
                POOL_WEIGHT,
                MIN_DEPOSIT,
                UNSTAKE_LOCKED_BLOCKS,
                true // 测试withUpdate=true
            );
            expect(await metaNodeStake.poolLength()).to.equal(2);
            const erc20Pool = await metaNodeStake.pool(ERC20_POOL_PID);
            expect(erc20Pool.stTokenAddress).to.equal(stakeToken.target);

            // 重复添加代币
            await expect(
                metaNodeStake.connect(admin).addPool(ZERO_ADDRESS, POOL_WEIGHT, MIN_DEPOSIT, UNSTAKE_LOCKED_BLOCKS, false)
            ).to.be.revertedWith("duplicate staking token");

            await expect(metaNodeStake.connect(nonAdmin).addPool(
                ZERO_ADDRESS,
                POOL_WEIGHT,
                MIN_DEPOSIT,
                UNSTAKE_LOCKED_BLOCKS,
                false
            )).to.be.reverted;
        });

        // 测试更新池信息
        it("should update pool info correctly", async function () {
            // 先添加ETH池
            await metaNodeStake.connect(admin).addPool(
                ZERO_ADDRESS,
                POOL_WEIGHT,
                MIN_DEPOSIT,
                UNSTAKE_LOCKED_BLOCKS,
                false
            );

            const newMinDeposit = ethers.parseEther("2");
            const newLockedBlocks = 20;
            await metaNodeStake.connect(admin).updatePool(ETH_PID, newMinDeposit, newLockedBlocks);
            const updatedPool = await metaNodeStake.pool(ETH_PID);
            expect(updatedPool.minDepositAmount).to.equal(newMinDeposit);
            expect(updatedPool.unstakeLockedBlocks).to.equal(newLockedBlocks);

            await expect(metaNodeStake.connect(admin).updatePool(999, newMinDeposit, newLockedBlocks))
                .to.be.revertedWith("invalid pid");
            await expect(metaNodeStake.connect(nonAdmin).updatePool(ETH_PID, newMinDeposit, newLockedBlocks))
                .to.be.reverted;
        });

        // 测试设置池权重
        it("should set pool weight correctly", async function () {
            // 先添加ETH池
            await metaNodeStake.connect(admin).addPool(
                ZERO_ADDRESS,
                POOL_WEIGHT,
                MIN_DEPOSIT,
                UNSTAKE_LOCKED_BLOCKS,
                false
            );
            expect(await metaNodeStake.totalPoolWeight()).to.equal(POOL_WEIGHT);

            const newWeight = 200;
            await metaNodeStake.connect(admin).setPoolWeight(ETH_PID, newWeight, true); // withUpdate=true
            expect(await metaNodeStake.totalPoolWeight()).to.equal(newWeight);
            const updatedPool = await metaNodeStake.pool(ETH_PID);
            expect(updatedPool.poolWeight).to.equal(newWeight);

            // 测试异常
            await expect(metaNodeStake.connect(admin).setPoolWeight(ETH_PID, 0, false))
                .to.be.revertedWith("invalid pool weight");
            await expect(metaNodeStake.connect(admin).setPoolWeight(999, newWeight, false))
                .to.be.revertedWith("invalid pid");
            await expect(metaNodeStake.connect(nonAdmin).setPoolWeight(ETH_PID, newWeight, false))
                .to.be.reverted;
        });
    });

    // ============================== 查询函数测试 ==============================
    describe("View Functions", function () {
        beforeEach(async function () {
            // 提前添加ETH池和ERC20池
            await metaNodeStake.connect(admin).addPool(
                ZERO_ADDRESS,
                POOL_WEIGHT,
                MIN_DEPOSIT,
                UNSTAKE_LOCKED_BLOCKS,
                false
            );

            await metaNodeStake.connect(admin).addPool(
                stakeToken.target,
                POOL_WEIGHT,
                MIN_DEPOSIT,
                UNSTAKE_LOCKED_BLOCKS,
                false
            );

            // user1质押ETH
            await metaNodeStake.connect(user1).depositETH({ value: MIN_DEPOSIT });
            // user1质押ERC20（先授权）
            await stakeToken.mint(user1.address, ethers.parseEther("10"));
            await stakeToken.connect(user1).approve(metaNodeStake.target, ethers.parseEther("10"));
            await metaNodeStake.connect(user1).deposit(ERC20_POOL_PID, MIN_DEPOSIT);
        });

        // 测试poolLength
        it("should return correct pool length", async function () {
            expect(await metaNodeStake.poolLength()).to.equal(2);
        });

        // 测试getMultiplier
        it("should calculate multiplier correctly", async function () {
            // 正常区间（在start和end之间）
            const from = START_BLOCK + 10;
            const to = START_BLOCK + 20;
            let multiplier = await metaNodeStake.getMultiplier(from, to);
            console.log("multiplier:", multiplier)
            // expect(multiplier).to.equal((to - from) * META_NODE_PER_BLOCK);

            // // from < startBlock
            // multiplier = await metaNodeStake.getMultiplier(START_BLOCK - 10, to);
            // expect(multiplier).to.equal((to - START_BLOCK) * META_NODE_PER_BLOCK);

            // // to > endBlock
            // multiplier = await metaNodeStake.getMultiplier(from, END_BLOCK + 10);
            // expect(multiplier).to.equal((END_BLOCK - from) * META_NODE_PER_BLOCK);

            // from > to
            await expect(metaNodeStake.getMultiplier(to, from))
                .to.be.revertedWith("invalid block");

            // 修正后from > to
            await expect(metaNodeStake.getMultiplier(END_BLOCK + 10, END_BLOCK + 5))
                .to.be.revertedWith("invalid block");
        });

        // 测试pendingMetaNode和pendingMetaNodeByBlockNumber
        it("should return correct pending MetaNode", async function () {
            // 快进区块，产生奖励
            const currentBlock = await getBlockNumber();
            const targetBlock = currentBlock + 10;
            await mineBlocks(10);

            // 查询当前待领取奖励
            const pending = await metaNodeStake.pendingMetaNode(ETH_PID, user1.address);
            expect(pending).to.be.gt(0);

            // 按指定区块查询
            const pendingByBlock = await metaNodeStake.pendingMetaNodeByBlockNumber(ETH_PID, user1.address, targetBlock);
            expect(pendingByBlock).to.equal(pending);

            // 无效pid
            await expect(metaNodeStake.pendingMetaNode(999, user1.address))
                .to.be.revertedWith("invalid pid");
        });

        // 测试stakingBalance
        it("should return correct staking balance", async function () {
            expect(await metaNodeStake.stakingBalance(ETH_PID, user1.address)).to.equal(MIN_DEPOSIT);
            expect(await metaNodeStake.stakingBalance(ERC20_POOL_PID, user1.address)).to.equal(MIN_DEPOSIT);
            expect(await metaNodeStake.stakingBalance(ETH_PID, user2.address)).to.equal(0);

            await expect(metaNodeStake.stakingBalance(999, user1.address))
                .to.be.revertedWith("invalid pid");
        });

        // 测试withdrawAmount
        it("should return correct withdraw amount", async function () {
            // user1申请解锁ETH
            await metaNodeStake.connect(user1).unstake(ETH_PID, MIN_DEPOSIT);
            let [totalRequest, pendingWithdraw] = await metaNodeStake.withdrawAmount(ETH_PID, user1.address);
            expect(totalRequest).to.equal(MIN_DEPOSIT);
            expect(pendingWithdraw).to.equal(0); // 未到解锁时间

            // 快进区块到解锁时间
            await mineBlocks(UNSTAKE_LOCKED_BLOCKS);
            [totalRequest, pendingWithdraw] = await metaNodeStake.withdrawAmount(ETH_PID, user1.address);
            expect(pendingWithdraw).to.equal(MIN_DEPOSIT);

            await expect(metaNodeStake.withdrawAmount(999, user1.address))
                .to.be.revertedWith("invalid pid");
        });
    });

    // ============================== 质押函数测试 ==============================
    describe("Deposit Functions", function () {
        beforeEach(async function () {
            // 提前添加ETH池和ERC20池
            await metaNodeStake.connect(admin).addPool(
                ZERO_ADDRESS,
                POOL_WEIGHT,
                MIN_DEPOSIT,
                UNSTAKE_LOCKED_BLOCKS,
                false
            );

            await metaNodeStake.connect(admin).addPool(
                stakeToken.target,
                POOL_WEIGHT,
                MIN_DEPOSIT,
                UNSTAKE_LOCKED_BLOCKS,
                false
            );

            // 给user1 mint ERC20
            await stakeToken.mint(user1.address, ethers.parseEther("10"));
        });

        // 测试updatePool和massUpdatePools
        it("should update pool and mass update correctly", async function () {
            // 单独更新ETH池
            await metaNodeStake.updatePool(ETH_PID);
            const ethPool = await metaNodeStake.pool(ETH_PID);
            expect(ethPool.lastRewardBlock).to.be.gte(START_BLOCK);

            // 批量更新
            await metaNodeStake.massUpdatePools();
            const erc20Pool = await metaNodeStake.pool(ERC20_POOL_PID);
            expect(erc20Pool.lastRewardBlock).to.be.gte(START_BLOCK);

            // 无效pid更新
            await expect(metaNodeStake.updatePool(999))
                .to.be.revertedWith("invalid pid");
        });

        // 测试depositETH
        it("should deposit ETH correctly", async function () {
            // 正常质押
            const tx = await metaNodeStake.connect(user1).depositETH({ value: MIN_DEPOSIT });
            await expect(tx)
                .to.emit(metaNodeStake, "Deposit")
                .withArgs(user1.address, ETH_PID, MIN_DEPOSIT);

            // 检查质押余额
            expect(await metaNodeStake.stakingBalance(ETH_PID, user1.address)).to.equal(MIN_DEPOSIT);
            const ethPool = await metaNodeStake.pool(ETH_PID);
            expect(ethPool.stTokenAmount).to.equal(MIN_DEPOSIT);

            // 质押金额不足最小额
            await expect(metaNodeStake.connect(user1).depositETH({ value: ethers.parseEther("0.01") }))
                .to.be.revertedWith("deposit amount is too small");

            // 非ETH池调用（先获取ERC20池地址）
            await expect(metaNodeStake.connect(user1).depositETH({ value: MIN_DEPOSIT }))
                .to.not.be.reverted; // ETH池只能是PID=0，这里测试非ETH池不能用depositETH（实际通过pid控制）
        });

        // 测试deposit（ERC20）
        it("should deposit ERC20 correctly", async function () {
            // 未授权质押
            await expect(metaNodeStake.connect(user1).deposit(ERC20_POOL_PID, MIN_DEPOSIT))
                .to.be.revertedWith("insufficient allowance");

            // 授权后质押
            await stakeToken.connect(user1).approve(metaNodeStake.target, MIN_DEPOSIT);
            const tx = await metaNodeStake.connect(user1).deposit(ERC20_POOL_PID, MIN_DEPOSIT);
            await expect(tx)
                .to.emit(metaNodeStake, "Deposit")
                .withArgs(user1.address, ERC20_POOL_PID, MIN_DEPOSIT);

            // 检查质押余额
            expect(await metaNodeStake.stakingBalance(ERC20_POOL_PID, user1.address)).to.equal(MIN_DEPOSIT);
            const erc20Pool = await metaNodeStake.pool(ERC20_POOL_PID);
            expect(erc20Pool.stTokenAmount).to.equal(MIN_DEPOSIT);

            // 质押金额不足最小额
            await stakeToken.connect(user1).approve(metaNodeStake.target, ethers.parseEther("0.01"));
            await expect(metaNodeStake.connect(user1).deposit(ERC20_POOL_PID, ethers.parseEther("0.01")))
                .to.be.revertedWith("deposit amount is too small");

            // ETH池调用deposit
            await expect(metaNodeStake.connect(user1).deposit(ETH_PID, MIN_DEPOSIT))
                .to.be.revertedWith("deposit not support ETH staking");
        });
    });

    // ============================== 解锁和提取函数测试 ==============================
    describe("Unstake and Withdraw Functions", function () {
        beforeEach(async function () {
            // 提前添加ETH池和ERC20池
            let tx = await metaNodeStake.connect(admin).addPool(
                ZERO_ADDRESS,
                POOL_WEIGHT,
                MIN_DEPOSIT,
                UNSTAKE_LOCKED_BLOCKS,
                false
            );
            await tx.wait()

            tx = await metaNodeStake.connect(admin).addPool(
                stakeToken.target,
                POOL_WEIGHT,
                MIN_DEPOSIT,
                UNSTAKE_LOCKED_BLOCKS,
                false
            );
            await tx.wait()

            // user1质押ETH和ERC20
            tx = await metaNodeStake.connect(user1).depositETH({ value: MIN_DEPOSIT });
            await tx.wait()
            tx = await stakeToken.mint(user1.address, ethers.parseEther("10"));
            await tx.wait()
            tx = await stakeToken.connect(user1).approve(metaNodeStake.target, ethers.parseEther("10"));
            await tx.wait()
            tx = await metaNodeStake.connect(user1).deposit(ERC20_POOL_PID, MIN_DEPOSIT);
            await tx.wait()
        });

        // 测试unstake
        it("should unstake correctly", async function () {
            // 正常申请解锁ETH
            let tx = await metaNodeStake.connect(user1).unstake(ETH_PID, MIN_DEPOSIT);
            await expect(tx)
                .to.emit(metaNodeStake, "RequestUnstake")
                .withArgs(user1.address, ETH_PID, MIN_DEPOSIT);

            // 检查质押余额和池总质押量
            expect(await metaNodeStake.stakingBalance(ETH_PID, user1.address)).to.equal(0);
            const ethPool = await metaNodeStake.pool(ETH_PID);
            expect(ethPool.stTokenAmount).to.equal(0);

            // 解锁金额超过质押余额
            await expect(metaNodeStake.connect(user1).unstake(ETH_PID, MIN_DEPOSIT))
                .to.be.revertedWith("Not enough staking token balance");

            // 无效pid
            await expect(metaNodeStake.connect(user1).unstake(999, MIN_DEPOSIT))
                .to.be.revertedWith("invalid pid");

            // 提取功能暂停时解锁
            tx = await metaNodeStake.connect(admin).pauseWithdraw();
            await tx.wait()
            await expect(metaNodeStake.connect(user1).unstake(ERC20_POOL_PID, MIN_DEPOSIT))
                .to.be.revertedWith("withdraw is paused");
        });

        // 测试withdraw（含申请顺序错乱场景）
        it("should withdraw correctly", async function () {
            // 场景1：正常提取（单申请）
            let tx = await metaNodeStake.connect(user1).unstake(ETH_PID, MIN_DEPOSIT);
            await tx.wait()
            const currentBlock = await getBlockNumber();
            await mineBlocks(UNSTAKE_LOCKED_BLOCKS);

            const user1BalanceBefore = await ethers.provider.getBalance(user1.address);
            tx = await metaNodeStake.connect(user1).withdraw(ETH_PID);

            console.log("gasUsed:", (await tx.wait()).gasUsed);
            console.log("gasPrice:", (await tx.wait()).gasPrice);
            // 检查ETH余额
            expect(await ethers.provider.getBalance(user1.address)).to.be.closeTo(
                user1BalanceBefore + (MIN_DEPOSIT),
                ethers.parseEther("0.001") // 允许gas误差
            );

            // 场景2：申请顺序错乱（先申请小金额，再申请大金额，解锁时间相反）
            tx = await metaNodeStake.connect(user1).deposit(ERC20_POOL_PID, ethers.parseEther("2"));
            await tx.wait()
            // 第一次申请：金额1，解锁时间T+20
            await mineBlocks(10);
            tx = await metaNodeStake.connect(user1).unstake(ERC20_POOL_PID, ethers.parseEther("1"));
            await tx.wait()
            // 第二次申请：金额1，解锁时间T+5（快进区块到T+15，再申请）
            await mineBlocks(15);
            tx = await metaNodeStake.connect(user1).unstake(ERC20_POOL_PID, ethers.parseEther("1"));
            await tx.wait()

            // 快进区块到T+10（第二个申请解锁，第一个未解锁）
            await mineBlocks(20);
            tx = await metaNodeStake.connect(user1).withdraw(ERC20_POOL_PID);
            await tx.wait()
            // // 检查未解锁申请是否保留
            // const [totalRequest, pendingWithdraw] = await metaNodeStake.withdrawAmount(ERC20_POOL_PID, user1.address);
            // expect(pendingWithdraw).to.equal(ethers.parseEther("1")); // 仅第一个申请未提取

            // 场景3：无已解锁申请
            await expect(metaNodeStake.connect(user2).withdraw(ETH_PID))
                .to.not.be.reverted; // 无申请时不报错

            // 无效pid
            await expect(metaNodeStake.connect(user1).withdraw(999))
                .to.be.revertedWith("invalid pid");

            // 提取功能暂停时提取
            tx = await metaNodeStake.connect(admin).pauseWithdraw();
            await tx.wait()
            await expect(metaNodeStake.connect(user1).withdraw(ERC20_POOL_PID))
                .to.be.revertedWith("withdraw is paused");
        });
    });

    // ============================== 领取奖励函数测试 ==============================
    describe("Claim Functions", function () {
        beforeEach(async function () {
            // 提前添加ETH池
            await metaNodeStake.connect(admin).addPool(
                ZERO_ADDRESS,
                POOL_WEIGHT,
                MIN_DEPOSIT,
                UNSTAKE_LOCKED_BLOCKS,
                false
            );

            // user1质押ETH
            tx = await metaNodeStake.connect(user1).depositETH({ value: MIN_DEPOSIT });
            await tx.wait();
            // 快进区块产生奖励
            await mineBlocks(10);
        });

        it("should claim reward correctly", async function () {
            // 正常领取
            // const user1BalanceBefore = await metaNodeToken.balanceOf(user1.address);
            // let tx = await metaNodeStake.connect(user1).claim(ETH_PID);
            // await expect(tx)
            //     .to.emit(metaNodeStake, "Claim")
            //     .withArgs(user1.address, ETH_PID, await metaNodeStake.pendingMetaNode(ETH_PID, user1.address));

            // expect(await metaNodeToken.balanceOf(user1.address)).to.be.gt(user1BalanceBefore);

            // // 无奖励可领取（领取后再次领取）
            // tx = await metaNodeStake.connect(user1).claim(ETH_PID);
            // await expect(tx)
            //     .to.emit(metaNodeStake, "Claim")
            //     .withArgs(user1.address, ETH_PID, 0);

            // 无效pid
            await expect(metaNodeStake.connect(user1).claim(999))
                .to.be.revertedWith("invalid pid");

            // 奖励代币不足（消耗完合约代币）
            tx = await metaNodeStake.connect(owner).safeTransferMetaNode(owner.address, await metaNodeToken.balanceOf(metaNodeStake.target));
            await tx.wait();
            await mineBlocks(20);
            await expect(metaNodeStake.connect(user1).claim(ETH_PID))
                .to.be.revertedWith("insufficient MetaNode balance in contract");

            // 领取功能暂停时领取
            tx = await metaNodeStake.connect(admin).pauseClaim();
            await tx.wait();
            await expect(metaNodeStake.connect(user1).claim(ETH_PID))
                .to.be.revertedWith("claim is paused");
        });
    });

    // ============================== 直接向合约转ETH ==============================
    describe("transfer ETH to MetaNodeStake", function () {
        it("直接向质押合约转账会回退", function () {
            const amount = ethers.parseEther("1.0");
            expect(admin.sendTransaction({
                to: metaNodeToken.target,
                value: amount,
            })).to.be.revertedWith("please use depositETH function to stake ETH");
        });
    });

    // ============================== 内部函数间接测试 ==============================
    describe("Internal Functions (Indirect)", function () {
        beforeEach(async function () {
            // 提前添加ETH池和ERC20池
            await metaNodeStake.connect(admin).addPool(
                ZERO_ADDRESS,
                POOL_WEIGHT,
                MIN_DEPOSIT,
                UNSTAKE_LOCKED_BLOCKS,
                false
            );
        });

        // 测试_safeMetaNodeTransfer（通过claim）
        it("should safe transfer MetaNode correctly", async function () {
            let tx = await metaNodeStake.connect(user1).depositETH({ value: MIN_DEPOSIT });
            await tx.wait()
            tx = await mineBlocks(10);
            await metaNodeStake.connect(user1).claim(ETH_PID);
            expect(await metaNodeToken.balanceOf(user1.address)).to.be.gt(0);
        });

        // 测试_deposit（通过depositETH和deposit）
        it("should internal deposit correctly", async function () {
            // 通过depositETH触发
            let tx = await metaNodeStake.connect(user1).depositETH({ value: MIN_DEPOSIT });
            await tx.wait()
            // 通过deposit（ERC20）触发
            tx = await metaNodeStake.connect(admin).addPool(
                stakeToken.target,
                POOL_WEIGHT,
                MIN_DEPOSIT,
                UNSTAKE_LOCKED_BLOCKS,
                false
            );
            await tx.wait()
            tx = await stakeToken.mint(user1.address, MIN_DEPOSIT);
            await tx.wait()
            tx = await stakeToken.connect(user1).approve(metaNodeStake.target, MIN_DEPOSIT);
            await tx.wait()
            tx = await metaNodeStake.connect(user1).deposit(ERC20_POOL_PID, MIN_DEPOSIT);
            await tx.wait()
        });
    });

    // ============================== 升级功能测试 ==============================
    describe("Upgrade Function", function () {
        it("should upgrade contract correctly", async function () {
            const implAddress = await upgrades.erc1967.getImplementationAddress(metaNodeStake.target);
            console.log("MetaNodeStake implAddress:", implAddress);
            // 部署新实现合约
            const MetaNodeStakeV2 = await ethers.getContractFactory("MetaNodeStakeV2");

            // 有升级权限的账户升级
            await upgrades.upgradeProxy(metaNodeStake.target, MetaNodeStakeV2);
            const upgradeImplAddress = await upgrades.erc1967.getImplementationAddress(metaNodeStake.target);
            console.log("Upgrade MetaNodeStake implAddress:", upgradeImplAddress);

            // 无升级权限的账户升级
            const upgradeRole = await metaNodeStake.UPGRADE_ROLE();
            expect(await metaNodeStake.hasRole(upgradeRole, nonAdmin.address)).to.be.false;
            const TempMetaNodeStakeV2 = await ethers.getContractFactory("MetaNodeStakeV2", nonAdmin);
            await expect(
                upgrades.upgradeProxy(metaNodeStake.target, TempMetaNodeStakeV2)
            ).to.be.reverted;

        });
    });

    // 辅助函数：获取当前区块号
    async function getBlockNumber() {
        return await ethers.provider.getBlockNumber();
    }

    // 辅助函数：挖矿指定数量的区块
    async function mineBlocks(blocks) {
        for (let i = 0; i < blocks; i++) {
            await ethers.provider.send("evm_mine", []);
        }
    }
});

