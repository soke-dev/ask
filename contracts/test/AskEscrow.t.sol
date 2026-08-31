// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {AskEscrow} from "../src/AskEscrow.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract AskEscrowTest is Test {
    AskEscrow escrow;
    MockUSDC usdc;

    // Private keys, so the tests sign the way real wallets do rather than
    // pranking their way past the checks that matter.
    uint256 askerKey = 0xA11CE;
    uint256 verifierKey = 0xB0B;
    uint256 strangerKey = 0xBAD;

    address asker;
    address verifier;
    address stranger;
    address arbiter = address(0xA);
    address treasury = address(0x7);
    address owner = address(this);
    address relayer = address(0xDEAD); // pays gas, decides nothing

    uint128 constant BOUNTY = 500e6; // $500
    uint16 constant FEE_BPS = 1_000; // 10%

    function setUp() public {
        asker = vm.addr(askerKey);
        verifier = vm.addr(verifierKey);
        stranger = vm.addr(strangerKey);

        usdc = new MockUSDC();

        AskEscrow implementation = new AskEscrow();
        bytes memory init = abi.encodeCall(
            AskEscrow.initialize, (address(usdc), arbiter, treasury, FEE_BPS)
        );
        escrow = AskEscrow(address(new ERC1967Proxy(address(implementation), init)));

        usdc.mint(asker, 10_000e6);
        usdc.mint(stranger, 10_000e6);
        vm.warp(1_700_000_000);
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    function _fundSig(uint256 key, bytes32 nonce, uint128 amount, uint64 validBefore)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
                ),
                vm.addr(key),
                address(escrow),
                uint256(amount),
                uint256(0),
                uint256(validBefore),
                nonce
            )
        );
        bytes32 digest = MessageHashUtils.toTypedDataHash(usdc.DOMAIN_SEPARATOR(), structHash);
        (v, r, s) = vm.sign(key, digest);
    }

    function _escrowDomain() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("AskEscrow"),
                keccak256("1"),
                block.chainid,
                address(escrow)
            )
        );
    }

    function _claimSig(uint256 key, bytes32 jobId, address who, bytes32 evidence)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Claim(bytes32 jobId,address verifier,bytes32 evidenceHash)"),
                jobId,
                who,
                evidence
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(key, MessageHashUtils.toTypedDataHash(_escrowDomain(), structHash));
        return abi.encodePacked(r, s, v);
    }

    function _releaseSig(uint256 key, bytes32 jobId, address who)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(keccak256("Release(bytes32 jobId,address verifier)"), jobId, who)
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(key, MessageHashUtils.toTypedDataHash(_escrowDomain(), structHash));
        return abi.encodePacked(r, s, v);
    }

    function _disputeSig(uint256 key, bytes32 jobId, address who)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(keccak256("Dispute(bytes32 jobId,address raisedBy)"), jobId, who)
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(key, MessageHashUtils.toTypedDataHash(_escrowDomain(), structHash));
        return abi.encodePacked(r, s, v);
    }

    /// Always through the relayer, because that is the only way it happens.
    function _dispute(uint256 key, bytes32 jobId, address who) internal {
        vm.prank(relayer);
        escrow.dispute(jobId, who, _disputeSig(key, jobId, who));
    }

    function _fund(bytes32 jobId, bytes32 salt) internal returns (uint64 deadline) {
        deadline = uint64(block.timestamp + 1 hours);
        bytes32 nonce = keccak256(abi.encode(jobId, BOUNTY, salt));
        (uint8 v, bytes32 r, bytes32 s) = _fundSig(askerKey, nonce, BOUNTY, deadline + 1 days);

        vm.prank(relayer);
        escrow.fund(jobId, asker, BOUNTY, deadline, salt, 0, deadline + 1 days, v, r, s);
    }

    function _claim(bytes32 jobId, bytes32 evidence) internal {
        vm.prank(relayer);
        escrow.claim(jobId, verifier, evidence, _claimSig(verifierKey, jobId, verifier, evidence));
    }

    // ─── The happy path ─────────────────────────────────────────────────────

    function test_fund_locksTheBounty() public {
        bytes32 jobId = keccak256("job-1");
        _fund(jobId, "salt");

        assertEq(usdc.balanceOf(address(escrow)), BOUNTY, "escrow holds the bounty");
        assertEq(usdc.balanceOf(asker), 10_000e6 - BOUNTY, "asker paid");

        AskEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AskEscrow.Status.Funded));
        assertEq(job.asker, asker);
    }

    function test_release_pays90PercentAndTakes10() public {
        bytes32 jobId = keccak256("job-2");
        _fund(jobId, "salt");
        _claim(jobId, keccak256("evidence"));

        vm.prank(relayer);
        escrow.release(jobId, _releaseSig(askerKey, jobId, verifier));

        assertEq(usdc.balanceOf(verifier), 450e6, "verifier gets 90%");
        assertEq(usdc.balanceOf(treasury), 50e6, "platform gets 10%");
        assertEq(usdc.balanceOf(address(escrow)), 0, "nothing left behind");
    }

    function test_claim_recordsTheEvidenceHash() public {
        bytes32 jobId = keccak256("job-3");
        bytes32 evidence = keccak256("the-video-bytes");
        _fund(jobId, "salt");
        _claim(jobId, evidence);

        AskEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(job.evidenceHash, evidence, "hash is on chain");
        assertEq(job.verifier, verifier, "payee recorded before any dispute");
    }

    // ─── Expiry ─────────────────────────────────────────────────────────────

    function test_refundExpired_returnsEverything() public {
        bytes32 jobId = keccak256("job-4");
        uint64 deadline = _fund(jobId, "salt");

        vm.warp(deadline + 1);
        // Deliberately a stranger: the safe outcome must not depend on us.
        vm.prank(stranger);
        escrow.refundExpired(jobId);

        assertEq(usdc.balanceOf(asker), 10_000e6, "asker made whole");
        assertEq(usdc.balanceOf(treasury), 0, "platform earns nothing on a refund");
    }

    function test_refundExpired_revertsBeforeDeadline() public {
        bytes32 jobId = keccak256("job-5");
        _fund(jobId, "salt");

        vm.expectRevert(AskEscrow.DeadlineNotReached.selector);
        escrow.refundExpired(jobId);
    }

    function test_refundExpired_revertsOnceClaimed() public {
        bytes32 jobId = keccak256("job-6");
        uint64 deadline = _fund(jobId, "salt");
        _claim(jobId, keccak256("evidence"));

        vm.warp(deadline + 1);
        // Somebody answered and is waiting on a decision. The deadline alone
        // must not hand the money back over their head.
        vm.expectRevert(
            abi.encodeWithSelector(AskEscrow.WrongStatus.selector, AskEscrow.Status.Claimed)
        );
        escrow.refundExpired(jobId);
    }

    // ─── Disputes ───────────────────────────────────────────────────────────

    function test_resolve_askerWins_refundsInFull() public {
        bytes32 jobId = keccak256("job-7");
        _fund(jobId, "salt");
        _claim(jobId, keccak256("evidence"));

        _dispute(askerKey, jobId, asker);

        vm.prank(arbiter);
        escrow.resolve(jobId, true);

        assertEq(usdc.balanceOf(asker), 10_000e6, "whole bounty back");
        assertEq(usdc.balanceOf(verifier), 0);
        assertEq(usdc.balanceOf(treasury), 0, "no fee on a refund");
    }

    function test_resolve_verifierWins_pays90Percent() public {
        bytes32 jobId = keccak256("job-8");
        _fund(jobId, "salt");
        _claim(jobId, keccak256("evidence"));

        _dispute(askerKey, jobId, asker);

        vm.prank(arbiter);
        escrow.resolve(jobId, false);

        assertEq(usdc.balanceOf(verifier), 450e6);
        assertEq(usdc.balanceOf(treasury), 50e6);
    }

    /// The security property the binary exists for: the arbiter decides who,
    /// never where. There is no parameter here that could name an attacker.
    function test_arbiter_cannotDivertFundsAnywhereElse() public {
        bytes32 jobId = keccak256("job-9");
        _fund(jobId, "salt");
        _claim(jobId, keccak256("evidence"));

        _dispute(askerKey, jobId, asker);

        uint256 strangerBefore = usdc.balanceOf(stranger);

        vm.prank(arbiter);
        escrow.resolve(jobId, false);

        assertEq(usdc.balanceOf(stranger), strangerBefore, "a third party gains nothing");
        assertEq(
            usdc.balanceOf(verifier) + usdc.balanceOf(treasury),
            BOUNTY,
            "every cent went to the two recorded parties"
        );
    }

    function test_resolve_onlyArbiter() public {
        bytes32 jobId = keccak256("job-10");
        _fund(jobId, "salt");
        _claim(jobId, keccak256("evidence"));
        _dispute(askerKey, jobId, asker);

        vm.prank(stranger);
        vm.expectRevert(AskEscrow.NotArbiter.selector);
        escrow.resolve(jobId, false);
    }

    function test_resolve_revertsWhenNotDisputed() public {
        bytes32 jobId = keccak256("job-11");
        _fund(jobId, "salt");
        _claim(jobId, keccak256("evidence"));

        // No dispute raised, so the arbiter has no standing at all.
        vm.prank(arbiter);
        vm.expectRevert(
            abi.encodeWithSelector(AskEscrow.WrongStatus.selector, AskEscrow.Status.Claimed)
        );
        escrow.resolve(jobId, false);
    }

    function test_dispute_onlyParties() public {
        bytes32 jobId = keccak256("job-12");
        _fund(jobId, "salt");
        _claim(jobId, keccak256("evidence"));

        vm.prank(relayer);
        vm.expectRevert(AskEscrow.NotAParty.selector);
        escrow.dispute(jobId, stranger, _disputeSig(strangerKey, jobId, stranger));
    }

    /**
     * The verifier's route to a decision when the asker goes quiet.
     *
     * They walked to the place and filmed it; without this their payment would
     * depend on somebody who has stopped answering.
     */
    function test_dispute_verifierCanRaiseWhenTheAskerGoesQuiet() public {
        bytes32 jobId = keccak256("job-20");
        _fund(jobId, "salt");
        _claim(jobId, keccak256("evidence"));

        _dispute(verifierKey, jobId, verifier);

        AskEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(uint8(job.status), uint8(AskEscrow.Status.Disputed));

        vm.prank(arbiter);
        escrow.resolve(jobId, false);
        assertEq(usdc.balanceOf(verifier), 450e6, "the reviewer can still pay them");
    }

    /**
     * Guards the bug this signature scheme exists for.
     *
     * Every transaction is submitted by a relayer paying the gas, so a
     * msg.sender check would compare against the relayer and reject both
     * parties every time. A test that pranks as the asker passes while testing
     * a path that cannot happen in production.
     */
    function test_dispute_worksWhenSubmittedByTheRelayer() public {
        bytes32 jobId = keccak256("job-21");
        _fund(jobId, "salt");
        _claim(jobId, keccak256("evidence"));

        vm.prank(relayer);
        escrow.dispute(jobId, asker, _disputeSig(askerKey, jobId, asker));

        assertEq(uint8(escrow.getJob(jobId).status), uint8(AskEscrow.Status.Disputed));
    }

    /// A party's own signature cannot be replayed onto a different job.
    function test_dispute_signatureIsBoundToTheJob() public {
        bytes32 jobA = keccak256("job-22a");
        bytes32 jobB = keccak256("job-22b");
        _fund(jobA, "salt-a");
        _claim(jobA, keccak256("evidence"));
        _fund(jobB, "salt-b");
        _claim(jobB, keccak256("evidence"));

        vm.prank(relayer);
        vm.expectRevert(AskEscrow.BadSignature.selector);
        escrow.dispute(jobB, asker, _disputeSig(askerKey, jobA, asker));
    }

    // ─── Signature enforcement ──────────────────────────────────────────────

    /// The relayer pays for everything and authorises nothing.
    function test_release_needsTheAskersSignature() public {
        bytes32 jobId = keccak256("job-13");
        _fund(jobId, "salt");
        _claim(jobId, keccak256("evidence"));

        vm.prank(relayer);
        vm.expectRevert(AskEscrow.BadSignature.selector);
        escrow.release(jobId, _releaseSig(strangerKey, jobId, verifier));
    }

    function test_claim_needsTheVerifiersSignature() public {
        bytes32 jobId = keccak256("job-14");
        _fund(jobId, "salt");

        vm.prank(relayer);
        vm.expectRevert(AskEscrow.BadSignature.selector);
        // Naming the verifier while signing with somebody else's key.
        escrow.claim(
            jobId, verifier, keccak256("e"), _claimSig(strangerKey, jobId, verifier, keccak256("e"))
        );
    }

    /// A release signed for one verifier must not pay a different one.
    function test_release_signatureIsBoundToTheVerifier() public {
        bytes32 jobId = keccak256("job-15");
        _fund(jobId, "salt");
        _claim(jobId, keccak256("evidence"));

        vm.prank(relayer);
        vm.expectRevert(AskEscrow.BadSignature.selector);
        escrow.release(jobId, _releaseSig(askerKey, jobId, stranger));
    }

    // ─── Nonce binding ──────────────────────────────────────────────────────

    /// The reason intent lives in the nonce: an authorisation for one job
    /// cannot be pointed at another.
    function test_fund_authorisationCannotBeReusedForAnotherJob() public {
        bytes32 jobA = keccak256("job-16a");
        bytes32 jobB = keccak256("job-16b");
        uint64 deadline = uint64(block.timestamp + 1 hours);

        bytes32 nonce = keccak256(abi.encode(jobA, BOUNTY, bytes32("salt")));
        (uint8 v, bytes32 r, bytes32 s) = _fundSig(askerKey, nonce, BOUNTY, deadline + 1 days);

        // Same signature, aimed at a different job. The contract recomputes
        // the nonce from jobB, gets a different value, and USDC rejects it.
        vm.prank(relayer);
        vm.expectRevert();
        escrow.fund(jobB, asker, BOUNTY, deadline, "salt", 0, deadline + 1 days, v, r, s);
    }

    function test_fund_authorisationCannotBeReusedForADifferentAmount() public {
        bytes32 jobId = keccak256("job-17");
        uint64 deadline = uint64(block.timestamp + 1 hours);

        bytes32 nonce = keccak256(abi.encode(jobId, BOUNTY, bytes32("salt")));
        (uint8 v, bytes32 r, bytes32 s) = _fundSig(askerKey, nonce, BOUNTY, deadline + 1 days);

        vm.prank(relayer);
        vm.expectRevert();
        escrow.fund(jobId, asker, BOUNTY * 2, deadline, "salt", 0, deadline + 1 days, v, r, s);
    }

    function test_fund_rejectsADuplicateJobId() public {
        bytes32 jobId = keccak256("job-18");
        _fund(jobId, "salt");

        // Written out rather than reusing the helper: expectRevert applies to
        // the next call, and the helper's vm.prank would consume it before
        // fund() was ever reached — the assertion would pass without testing
        // anything.
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes32 nonce = keccak256(abi.encode(jobId, BOUNTY, bytes32("salt-2")));
        (uint8 v, bytes32 r, bytes32 s) = _fundSig(askerKey, nonce, BOUNTY, deadline + 1 days);

        vm.expectRevert(AskEscrow.JobExists.selector);
        escrow.fund(jobId, asker, BOUNTY, deadline, "salt-2", 0, deadline + 1 days, v, r, s);
    }

    // ─── Tips ───────────────────────────────────────────────────────────────

    function test_tip_splits90_10AndKeepsNothing() public {
        uint128 amount = 100e6;
        bytes32 nonce = keccak256(abi.encode(asker, amount, bytes32("tip")));
        (uint8 v, bytes32 r, bytes32 s) =
            _fundSig(strangerKey, nonce, amount, uint64(block.timestamp + 1 hours));

        vm.prank(relayer);
        escrow.tip(stranger, asker, amount, "tip", 0, block.timestamp + 1 hours, v, r, s);

        assertEq(usdc.balanceOf(asker), 10_000e6 + 90e6, "asker gets 90%");
        assertEq(usdc.balanceOf(treasury), 10e6, "platform gets 10%");
        assertEq(usdc.balanceOf(address(escrow)), 0, "contract never holds a tip");
    }

    function test_tip_recipientIsBoundIntoTheSignature() public {
        uint128 amount = 100e6;
        bytes32 nonce = keccak256(abi.encode(asker, amount, bytes32("tip")));
        (uint8 v, bytes32 r, bytes32 s) =
            _fundSig(strangerKey, nonce, amount, uint64(block.timestamp + 1 hours));

        // The relayer tries to redirect the tip to itself.
        vm.prank(relayer);
        vm.expectRevert();
        escrow.tip(stranger, relayer, amount, "tip", 0, block.timestamp + 1 hours, v, r, s);
    }

    // ─── Administration and upgrades ────────────────────────────────────────

    function test_fee_cannotExceedTheCeiling() public {
        vm.expectRevert(AskEscrow.FeeTooHigh.selector);
        escrow.setFee(2_001);
    }

    function test_arbiterCannotUpgrade() public {
        AskEscrow next = new AskEscrow();

        // Two powers, two keys. An arbiter who could upgrade could rewrite
        // every rule above, which would make the rest of this pointless.
        vm.prank(arbiter);
        vm.expectRevert();
        escrow.upgradeToAndCall(address(next), "");
    }

    function test_ownerCanUpgradeAndStateSurvives() public {
        bytes32 jobId = keccak256("job-19");
        _fund(jobId, "salt");

        AskEscrow next = new AskEscrow();
        escrow.upgradeToAndCall(address(next), "");

        AskEscrow.Job memory job = escrow.getJob(jobId);
        assertEq(job.amount, BOUNTY, "escrowed money survives an upgrade");
        assertEq(uint8(job.status), uint8(AskEscrow.Status.Funded));
        assertEq(usdc.balanceOf(address(escrow)), BOUNTY);
    }

    function test_implementationCannotBeInitialised() public {
        AskEscrow implementation = new AskEscrow();
        // An uninitialised implementation is one anybody can take ownership of.
        vm.expectRevert();
        implementation.initialize(address(usdc), arbiter, treasury, FEE_BPS);
    }

    // ─── Arithmetic ─────────────────────────────────────────────────────────

    /// The split must never create or destroy a cent, at any amount.
    function testFuzz_splitIsExact(uint128 amount) public view {
        vm.assume(amount > 0);
        (uint256 paid, uint256 fee) = escrow.split(amount);
        assertEq(paid + fee, amount, "no rounding leak");
    }
}
