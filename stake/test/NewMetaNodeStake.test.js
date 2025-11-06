const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("NewMetaNodeStake 完整测试", function () {
    // 全局变量
    let MetaNodeStake;      // 可升级质押系统合约
    let metaNodeStake;      // 可升级质押系统合约实例
    let metaNodeStakeAddr;  // 可升级质押系统合约地址
    let RewardToken;        // 奖励代币合约
    let rewardToken;        // 奖励代币合约实例
    let rewardTokenAddr;    // 奖励代币合约地址
    let StakeToken;         // 测试用ERC20质押代币
    let stakeToken;         // 测试用ERC20质押代币实例
    let stakeTokenAddr;     // 测试用ERC20质押代币地址
    let owner, admin, upgrader, user1, user2; // 测试账户
    const ETH_POOL_PID = 0;     // 0号ETH池
    const ERC20_POOL_PID = 1;   // 1号ERC20池
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

    // 部署合约与初始化（每个测试前执行）
    beforeEach(async function () {
        // 获取签名者（账户）
        [owner, admin, upgrader, user1, user2] = await ethers.getSigners();
        console.log("开始部署合约...");
        // 部署奖励代币（MetaNode）
        RewardToken = await ethers.getContractFactory("MetaNode");
        rewardToken = await RewardToken.deploy();
        await rewardToken.waitForDeployment();
        rewardTokenAddr = rewardToken.target;
        console.log("奖励代币合约地址:", rewardTokenAddr);

        // 部署测试用ERC20质押代币
        StakeToken = await ethers.getContractFactory("StakeERC20");
        stakeToken = await StakeToken.deploy();
        await stakeToken.waitForDeployment();
        stakeTokenAddr = stakeToken.target;
        console.log("测试用ERC20质押代币地址:", stakeTokenAddr);

        // 部署可升级质押系统合约
        MetaNodeStake = await ethers.getContractFactory("NewMetaNodeStake");
        metaNodeStake = await upgrades.deployProxy(MetaNodeStake, [
            rewardTokenAddr, // 奖励代币地址
            ethers.parseEther("100"), // 基础奖励：每区块100 MetaNode
        ], { initializer: "initialize" });
        await metaNodeStake.waitForDeployment();
        metaNodeStakeAddr = metaNodeStake.target;
        console.log("可升级质押系统合约地址:", metaNodeStakeAddr);

        // 分配角色（owner初始拥有所有角色，这里单独分配便于测试权限）
        await metaNodeStake.grantRole(
            await metaNodeStake.ADMIN_ROLE(),
            admin.address
        );
        await metaNodeStake.grantRole(
            await metaNodeStake.UPGRADER_ROLE(),
            upgrader.address
        );

        console.log("\nOwner RewardToken balance:", await rewardToken.balanceOf(owner.address));
        // 向质押系统转入奖励代币（用于用户领取）
        await rewardToken.transfer(
            metaNodeStakeAddr,
            ethers.parseEther("10000")
        );

        // 向用户1转入测试ERC20代币（用于质押）
        await stakeToken.transfer(user1.address, ethers.parseEther("10000"));
    });

    // 1. 初始化测试
    describe("初始化测试", function () {
        it("应正确初始化奖励代币和基础奖励率", async function () {
            expect(await metaNodeStake.rewardToken()).to.equal(rewardTokenAddr);
            expect(await metaNodeStake.baseRewardPerBlock()).to.equal(
                ethers.parseEther("100")
            );
        });

        it("应正确分配初始角色", async function () {
            expect(
                await metaNodeStake.hasRole(
                    await metaNodeStake.DEFAULT_ADMIN_ROLE(),
                    owner.address
                )
            ).to.be.true;
            expect(
                await metaNodeStake.hasRole(
                    await metaNodeStake.ADMIN_ROLE(),
                    admin.address
                )
            ).to.be.true;
            expect(
                await metaNodeStake.hasRole(
                    await metaNodeStake.UPGRADER_ROLE(),
                    upgrader.address
                )
            ).to.be.true;
        });
    });

    // 2. 质押池管理测试（核心）
    describe("质押池管理", function () {
        it("管理员应能添加0号ETH池", async function () {
            // 添加0号ETH池
            await expect(
                metaNodeStake
                    .connect(admin)
                    .addOrUpdatePool(
                        ETH_POOL_PID, // 池ID=0
                        ZERO_ADDRESS, // ETH地址用0表示
                        true, // 是ETH池
                        100, // 权重100
                        ethers.parseEther("0.0001"), // 最小质押0.001 ETH
                        100 // 锁定期100区块
                    )
            )
                .to.emit(metaNodeStake, "PoolAdded")
                .withArgs(ETH_POOL_PID, ZERO_ADDRESS, true, 100);

            // 验证池配置
            const poolInfo = await metaNodeStake.pools(ETH_POOL_PID);
            expect(poolInfo.stToken).to.equal(ZERO_ADDRESS);
            expect(poolInfo.isEth).to.be.true;
            expect(poolInfo.poolWeight).to.equal(100);
            expect(poolInfo.minDepositAmount).to.equal(
                ethers.parseEther("0.0001")
            );
            expect(poolInfo.unstakeLockedBlocks).to.equal(100);
            expect(poolInfo.exists).to.be.true;
        });

        it("非0号池必须在0号ETH池添加后才能创建", async function () {
            // 未添加0号池时直接添加ERC20池 → 应失败
            await expect(
                metaNodeStake
                    .connect(admin)
                    .addOrUpdatePool(
                        ERC20_POOL_PID,
                        stakeTokenAddr,
                        false,
                        50,
                        ethers.parseEther("100"),
                        100
                    )
            ).to.be.revertedWith("first add 0 poll");

            // 先添加0号ETH池
            await metaNodeStake
                .connect(admin)
                .addOrUpdatePool(ETH_POOL_PID, ZERO_ADDRESS, true, 100, ethers.parseEther("0.0001"), 100);

            // 再添加ERC20池 → 应成功
            await expect(
                metaNodeStake
                    .connect(admin)
                    .addOrUpdatePool(
                        ERC20_POOL_PID,
                        stakeTokenAddr,
                        false,
                        50,
                        ethers.parseEther("100"),
                        100
                    )
            )
                .to.emit(metaNodeStake, "PoolAdded")
                .withArgs(ERC20_POOL_PID, stakeTokenAddr, false, 50);
        });

        it("管理员应能更新池配置（权重、最小质押量等）", async function () {
            // 先添加0号和1号池
            await metaNodeStake
                .connect(admin)
                .addOrUpdatePool(ETH_POOL_PID, ZERO_ADDRESS, true, 100, ethers.parseEther("0.0001"), 100);
            await metaNodeStake
                .connect(admin)
                .addOrUpdatePool(ERC20_POOL_PID, stakeTokenAddr, false, 50, ethers.parseEther("100"), 100);

            // 更新1号池权重和锁定期
            await expect(
                metaNodeStake
                    .connect(admin)
                    .addOrUpdatePool(
                        ERC20_POOL_PID,
                        stakeTokenAddr,
                        false,
                        80, // 新权重80
                        ethers.parseEther("20"), // 新最小质押20
                        80 // 新锁定期80
                    )
            )
                .to.emit(metaNodeStake, "PoolUpdated")
                .withArgs(ERC20_POOL_PID, 80, ethers.parseEther("20"), 80);

            // 验证更新后的数据
            const updatedPool = await metaNodeStake.pools(ERC20_POOL_PID);
            expect(updatedPool.poolWeight).to.equal(80);
            expect(updatedPool.minDepositAmount).to.equal(ethers.parseEther("20"));
            expect(updatedPool.unstakeLockedBlocks).to.equal(80);
        });

        it("非管理员不能添加/更新池", async function () {
            await expect(
                metaNodeStake
                    .connect(user1) // 用户1无权限
                    .addOrUpdatePool(ETH_POOL_PID, ZERO_ADDRESS, true, 100, ethers.parseEther("0.0001"), 100)
            ).to.be.reverted;
        });
    });

    // 3. 质押功能测试
    describe("质押功能", function () {
        beforeEach(async function () {
            // 准备工作：添加0号ETH池和1号ERC20池
            await metaNodeStake
                .connect(admin)
                .addOrUpdatePool(ETH_POOL_PID, ZERO_ADDRESS, true, 100, ethers.parseEther("0.0001"), 100);
            await metaNodeStake
                .connect(admin)
                .addOrUpdatePool(ERC20_POOL_PID, stakeTokenAddr, false, 50, ethers.parseEther("100"), 100);

            // 用户1授权ERC20代币给质押合约
            await stakeToken
                .connect(user1)
                .approve(metaNodeStakeAddr, ethers.parseEther("10000"));
        });

        it("用户应能质押ERC20代币到1号池", async function () {
            const stakeAmount = ethers.parseEther("1000");

            // 执行质押
            await expect(
                metaNodeStake.connect(user1).stake(ERC20_POOL_PID, stakeAmount)
            )
                .to.emit(metaNodeStake, "Staked")
                .withArgs(user1.address, ERC20_POOL_PID, stakeAmount, await getBlockNumber()+1);

            // 验证用户质押量
            const userStake = await metaNodeStake.userStakeInfos(user1.address, ERC20_POOL_PID);
            expect(userStake.stakedAmount).to.equal(stakeAmount);

            // 验证池总质押量
            const poolInfo = await metaNodeStake.pools(ERC20_POOL_PID);
            expect(poolInfo.totalStaked).to.equal(stakeAmount);
        });

        it("用户应能质押ETH到0号池", async function () {
            const stakeAmount = ethers.parseEther("0.0002");

            // 执行ETH质押（带value）
            await expect(
                metaNodeStake.connect(user1).stakeEth({ value: stakeAmount })
            )
                .to.emit(metaNodeStake, "EthStaked")
                .withArgs(user1.address, stakeAmount, await getBlockNumber()+1);

            // 验证用户质押量
            const userStake = await metaNodeStake.userStakeInfos(user1.address, ETH_POOL_PID);
            expect(userStake.stakedAmount).to.equal(stakeAmount);

            // 验证池总质押量
            const poolInfo = await metaNodeStake.pools(ETH_POOL_PID);
            expect(poolInfo.totalStaked).to.equal(stakeAmount);
        });

        it("质押量低于最小要求应失败", async function () {
            // ERC20池最小质押100，尝试质押50 → 失败
            await expect(
                metaNodeStake
                    .connect(user1)
                    .stake(ERC20_POOL_PID, ethers.parseEther("50"))
            ).to.be.revertedWith("low minDepositAmount");

            // ETH池最小质押0.0001，尝试质押0.00005 → 失败
            await expect(
                metaNodeStake.connect(user1).stakeEth({ value: ethers.parseEther("0.00005") })
            ).to.be.revertedWith("low minDepositAmount");
        });

        it("质押功能暂停后不能质押", async function () {
            // 管理员暂停质押功能
            await metaNodeStake
                .connect(admin)
                .pauseFunction(0); // 0对应FunctionType.STAKE

            // 尝试质押 → 失败
            await expect(
                metaNodeStake
                    .connect(user1)
                    .stake(ERC20_POOL_PID, ethers.parseEther("100"))
            ).to.be.revertedWith("stake function is paused");

            // 恢复功能后质押 → 成功
            await metaNodeStake.connect(admin).unpauseFunction(0);
            await expect(
                metaNodeStake
                    .connect(user1)
                    .stake(ERC20_POOL_PID, ethers.parseEther("100"))
            ).to.emit(metaNodeStake, "Staked");
        });
    });

    // 4. 解质押功能测试
    describe("解质押功能", function () {
        beforeEach(async function () {
            // 准备工作：添加池并让用户1质押
            await metaNodeStake
                .connect(admin)
                .addOrUpdatePool(ETH_POOL_PID, ZERO_ADDRESS, true, 100, ethers.parseEther("0.0001"), 100); // 锁定期100块
            await metaNodeStake
                .connect(admin)
                .addOrUpdatePool(ERC20_POOL_PID, stakeTokenAddr, false, 50, ethers.parseEther("10"), 50); // 锁定期50块

            // 用户1质押ERC20和ETH
            await stakeToken.connect(user1).approve(metaNodeStakeAddr, ethers.parseEther("1000"));
            await metaNodeStake.connect(user1).stake(ERC20_POOL_PID, ethers.parseEther("500"));
            await metaNodeStake.connect(user1).stakeEth({ value: ethers.parseEther("0.0002") });
        });

        it("用户应能发起解质押请求", async function () {
            const unstakeAmount = ethers.parseEther("200");

            // 发起ERC20解质押
            await expect(
                metaNodeStake.connect(user1).unstake(ERC20_POOL_PID, unstakeAmount)
            )
                .to.emit(metaNodeStake, "UnstakeRequested")
                .withArgs(
                    user1.address,
                    ERC20_POOL_PID,
                    unstakeAmount,
                    (await getBlockNumber()) + 51 // 解锁区块=当前+50
                );

            // 验证用户剩余质押量
            const userStake = await metaNodeStake.userStakeInfos(user1.address, ERC20_POOL_PID);
            expect(userStake.stakedAmount).to.equal(ethers.parseEther("300")); // 500-200

            // 验证解质押请求已记录
            const requests = userStake.unstakeRequests;
            console.log("requests:", requests);
            // expect((await requests[0]).amount).to.equal(unstakeAmount);
        });

        it("锁定期内不能提取解质押资产", async function () {
            // 发起解质押
            await metaNodeStake.connect(user1).unstake(ERC20_POOL_PID, ethers.parseEther("200"));

            // 立即尝试提取（未到锁定期）→ 失败
            await expect(
                metaNodeStake.connect(user1).withdrawUnstaked(ERC20_POOL_PID)
            ).to.be.revertedWith("zero withdrawable");
        });

        it("锁定期后应能提取解质押资产", async function () {
            // 发起ERC20解质押
            await metaNodeStake.connect(user1).unstake(ERC20_POOL_PID, ethers.parseEther("200"));

            // 快速挖矿50个区块（满足锁定期）
            await mineBlocks(50);

            // 提取资产
            const userInitialBalance = await stakeToken.balanceOf(user1.address);
            await expect(
                metaNodeStake.connect(user1).withdrawUnstaked(ERC20_POOL_PID)
            )
                .to.emit(metaNodeStake, "UnstakedWithdrawn")
                .withArgs(
                    user1.address,
                    ERC20_POOL_PID,
                    ethers.parseEther("200"),
                    await getBlockNumber()+1
                );

            // 验证用户余额增加
            expect(await stakeToken.balanceOf(user1.address)).to.equal(
                userInitialBalance + ethers.parseEther("200")
            );
        });

        it("ETH解质押提取应正确转账ETH", async function () {
            // 发起ETH解质押
            await metaNodeStake.connect(user1).unstake(ETH_POOL_PID, ethers.parseEther("0.0002"));

            // 快速挖矿100个区块（满足锁定期）
            await mineBlocks(100);

            // 提取ETH
            const userInitialEth = await ethers.provider.getBalance(user1.address);
            const tx = await metaNodeStake.connect(user1).withdrawUnstaked(ETH_POOL_PID);
            await tx.wait();
            const userFinalEth = await ethers.provider.getBalance(user1.address);

            // 验证用户ETH余额增加
            expect(userFinalEth).to.closeTo(userInitialEth + ethers.parseEther("0.0002"), ethers.parseEther("0.0001"));
        });

        it("解质押数量超过质押量应失败", async function () {
            await expect(
                metaNodeStake.connect(user1).unstake(ERC20_POOL_PID, ethers.parseEther("1000")) // 用户仅质押500
            ).to.be.revertedWith("more than staked");
        });
    });

    // 5. 奖励计算与领取测试
    describe("奖励计算与领取", function () {
        beforeEach(async function () {
            // 准备工作：添加池并质押
            await metaNodeStake
                .connect(admin)
                .addOrUpdatePool(ETH_POOL_PID, ZERO_ADDRESS, true, 100, ethers.parseEther("0.1"), 100); // 权重100
            await metaNodeStake
                .connect(admin)
                .addOrUpdatePool(ERC20_POOL_PID, stakeTokenAddr, false, 100, ethers.parseEther("10"), 50); // 权重100（总权重200）

            // 用户1质押ERC20（500 TEST），用户2质押ETH（5 ETH）
            await stakeToken.connect(user1).approve(metaNodeStakeAddr, ethers.parseEther("1000"));
            await metaNodeStake.connect(user1).stake(ERC20_POOL_PID, ethers.parseEther("500"));
            await metaNodeStake.connect(user2).stakeEth({ value: ethers.parseEther("5") });
        });

        it("奖励应按权重和质押比例计算", async function () {
            // 基础奖励：每区块100 META，总权重200 → 单池每区块奖励=100*(100/200)=50 META
            // 用户1在ERC20池质押500（池总质押500）→ 占比100% → 每区块得50 META
            // 挖矿10个区块 → 预期奖励：50*10=500 META

            // 挖矿10个区块
            await mineBlocks(9);

            // 查看待领取奖励
            const pendingReward = await metaNodeStake.getUserPendingReward(ERC20_POOL_PID, user1.address);
            expect(pendingReward).to.equal(ethers.parseEther("500")); // 50*10=500
        });

        it("用户应能领取奖励", async function () {
            // 挖矿10个区块，生成奖励
            await mineBlocks(8);

            // 领取奖励前用户余额
            const initialBalance = await rewardToken.balanceOf(user1.address);

            // 领取奖励
            await expect(
                metaNodeStake.connect(user1).claimReward(ERC20_POOL_PID)
            )
                .to.emit(metaNodeStake, "RewardClaimed")
                .withArgs(
                    user1.address,
                    ERC20_POOL_PID,
                    ethers.parseEther("500"),
                    ethers.parseEther("500") // 累计领取=500
                );

            // 验证奖励到账
            expect(await rewardToken.balanceOf(user1.address)).to.equal(
                initialBalance + ethers.parseEther("500")
            );

            // 验证待领取奖励已清零
            const afterClaimPending = await metaNodeStake.getUserPendingReward(ERC20_POOL_PID, user1.address);
            expect(afterClaimPending).to.equal(0);
        });

        // it("无奖励时领取应失败", async function () {
        //     // 未挖矿，无奖励 → 领取失败
        //     await expect(
        //         metaNodeStake.connect(user1).claimReward(ERC20_POOL_PID)
        //     ).to.be.revertedWith("zero claimReward");
        // });
    });

    // 6. 管理员其他功能测试
    describe("管理员其他功能", function () {
        it("管理员应能调整基础奖励率", async function () {
            // 初始基础奖励：100 META/区块
            await expect(
                metaNodeStake.connect(admin).setBaseRewardPerBlock(ethers.parseEther("200"))
            )
                .to.emit(metaNodeStake, "BaseRewardUpdated")
                .withArgs(ethers.parseEther("100"), ethers.parseEther("200"));

            expect(await metaNodeStake.baseRewardPerBlock()).to.equal(ethers.parseEther("200"));
        });

        it("管理员应能单独更新池权重", async function () {
            // 先添加0号池
            await metaNodeStake
                .connect(admin)
                .addOrUpdatePool(ETH_POOL_PID, ZERO_ADDRESS, true, 100, ethers.parseEther("0.1"), 100);

            // 更新权重
            await expect(
                metaNodeStake.connect(admin).updatePoolWeight(ETH_POOL_PID, 200)
            )
                .to.emit(metaNodeStake, "PoolUpdated")
                .withArgs(ETH_POOL_PID, 200, ethers.parseEther("0.1"), 100);

            // 验证总权重更新（原100 → 200）
            expect(await metaNodeStake.totalPoolWeight()).to.equal(200);
        });

        it("非管理员不能调整奖励率或权重", async function () {
            await expect(
                metaNodeStake.connect(user1).setBaseRewardPerBlock(ethers.parseEther("200"))
            ).to.be.reverted;

            await metaNodeStake
                .connect(admin)
                .addOrUpdatePool(ETH_POOL_PID, ZERO_ADDRESS, true, 100, ethers.parseEther("0.1"), 100);
            await expect(
                metaNodeStake.connect(user1).updatePoolWeight(ETH_POOL_PID, 200)
            ).to.be.reverted;
        });
    });

    // 7. UUPS升级权限测试
    // describe("UUPS升级权限", function () {
    //     it("只有UPGRADER_ROLE能升级合约", async function () {
    //         // 准备一个新的实现合约（仅用于测试升级权限）
    //         const NewImplementation = await ethers.getContractFactory("NewMetaNodeStakeV2");
    //         const newImpl = await NewImplementation.deploy();
    //         await newImpl.waitForDeployment();

    //         // 非升级角色尝试升级 → 失败
    //         await expect(
    //             upgrades.upgradeProxy(metaNodeStakeAddr, newImpl, {
    //                 deployer: user1, // 使用user1签名
    //             })
    //         ).to.be.reverted;

    //         // 升级角色升级 → 成功（不验证功能，仅验证权限）
    //         await upgrades.upgradeProxy(metaNodeStakeAddr, newImpl, {
    //             deployer: upgrader, // 使用upgrader签名
    //         });
    //     });
    // });

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