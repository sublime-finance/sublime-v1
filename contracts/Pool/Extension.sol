// SPDX-License-Identifier: MIT
pragma solidity 0.7.0;

import '@openzeppelin/contracts-upgradeable/proxy/Initializable.sol';
import '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import '../interfaces/IPool.sol';
import '../interfaces/IPoolFactory.sol';
import '../interfaces/IExtension.sol';
import '../interfaces/IRepayment.sol';

contract Extension is Initializable, IExtension {
    using SafeMath for uint256;

    struct PoolInfo {
        uint256 periodWhenExtensionIsPassed;
        uint256 totalExtensionSupport;
        uint256 extensionVoteEndTime;
        uint256 repaymentInterval;
        mapping(address => uint256) lastVoteTime;
    }

    mapping(address => PoolInfo) public poolInfo;
    IPoolFactory poolFactory;
    uint256 votingPassRatio;

    modifier onlyOwner() {
        require(msg.sender == poolFactory.owner(), "Not owner");
        _;
    }

    /*
    * @notice emitted when the Voting Pass Ratio parameter for Open Borrow Pools is updated
    * @param votingPassRatio the new value of the voting pass ratio for Open Borrow Pools
    */
    event VotingPassRatioUpdated(uint256 votingPassRatio);
    event PoolFactoryUpdated(address poolFactory);

    event ExtensionRequested(uint256 extensionVoteEndTime);
    event ExtensionPassed(uint256 loanInterval);
    event LenderVoted(address lender, uint256 totalExtensionSupport, uint256 lastVoteTime);

    modifier onlyBorrower(address _pool) {
        require(IPool(_pool).borrower() == msg.sender, 'Not Borrower');
        _;
    }

    function initialize(address _poolFactory, uint256 _votingPassRatio) external initializer {
        _updatePoolFactory(_poolFactory);
        _updateVotingPassRatio(_votingPassRatio);
    }

    function initializePoolExtension(uint256 _repaymentInterval) external override {
        IPoolFactory _poolFactory = poolFactory;
        require(
            poolInfo[msg.sender].repaymentInterval == 0,
            'Extension::initializePoolExtension - _repaymentInterval cannot be 0'
        );
        require(_poolFactory.openBorrowPoolRegistry(msg.sender), 'Repayments::onlyValidPool - Invalid Pool');
        poolInfo[msg.sender].repaymentInterval = _repaymentInterval;
    }

    function requestExtension(address _pool) external onlyBorrower(_pool) {
        uint256 _repaymentInterval = poolInfo[_pool].repaymentInterval;
        require(_repaymentInterval != 0);
        uint256 _extensionVoteEndTime = poolInfo[_pool].extensionVoteEndTime;
        require(block.timestamp > _extensionVoteEndTime, 'Extension::requestExtension - Extension requested already'); // _extensionVoteEndTime is 0 when no extension is active

        // This check is required so that borrower doesn't ask for more extension if previously an extension is already granted
        require(
            poolInfo[_pool].periodWhenExtensionIsPassed == 0,
            'Extension::requestExtension: Extension already availed'
        );

        poolInfo[_pool].totalExtensionSupport = 0; // As we can multiple voting every time new voting start we have to make previous votes 0
        IRepayment _repayment = IRepayment(poolFactory.repaymentImpl());
        uint256 _nextDueTime = _repayment.getNextInstalmentDeadline(_pool);
        _extensionVoteEndTime = (_nextDueTime).div(10**30);
        poolInfo[_pool].extensionVoteEndTime = _extensionVoteEndTime; // this makes extension request single use
        emit ExtensionRequested(_extensionVoteEndTime);
    }

    function voteOnExtension(address _pool) external {
        uint256 _extensionVoteEndTime = poolInfo[_pool].extensionVoteEndTime;
        require(
            block.timestamp < _extensionVoteEndTime,
            "Pool::voteOnExtension - Voting is over"
        );

        (uint256 _balance, uint256 _totalSupply) = IPool(_pool).getBalanceDetails(msg.sender);
        require(_balance != 0, 'Pool::voteOnExtension - Not a valid lender for pool');

        uint256 _votingPassRatio = votingPassRatio;

        uint256 _lastVoteTime = poolInfo[_pool].lastVoteTime[msg.sender]; //Lender last vote time need to store it as it checks that a lender only votes once
        uint256 _repaymentInterval = poolInfo[_pool].repaymentInterval;
        require(
            _lastVoteTime < _extensionVoteEndTime.sub(_repaymentInterval),
            'Pool::voteOnExtension - you have already voted'
        );

        uint256 _extensionSupport = poolInfo[_pool].totalExtensionSupport;
        _lastVoteTime = block.timestamp;
        _extensionSupport = _extensionSupport.add(_balance);

        poolInfo[_pool].lastVoteTime[msg.sender] = _lastVoteTime;
        emit LenderVoted(msg.sender, _extensionSupport, _lastVoteTime);
        poolInfo[_pool].totalExtensionSupport = _extensionSupport;

        if (((_extensionSupport)) >= (_totalSupply.mul(_votingPassRatio)).div(10**30)) {
            grantExtension(_pool);
        }
    }

    function grantExtension(address _pool) internal {
        IPoolFactory _poolFactory = poolFactory;
        IRepayment _repayment = IRepayment(_poolFactory.repaymentImpl());

        uint256 _currentLoanInterval = _repayment.getCurrentLoanInterval(_pool);
        poolInfo[_pool].periodWhenExtensionIsPassed = _currentLoanInterval;
        poolInfo[_pool].extensionVoteEndTime = block.timestamp; // voting is over

        _repayment.instalmentDeadlineExtended(_pool, _currentLoanInterval);

        emit ExtensionPassed(_currentLoanInterval);
    }

    function closePoolExtension() external override {
        delete poolInfo[msg.sender];
    }

    function updateVotingPassRatio(uint256 _votingPassRatio)
        public
        onlyOwner
    {
        _updateVotingPassRatio(_votingPassRatio);
    }

    function _updateVotingPassRatio(uint256 _votingPassRatio)
        internal
    {
        votingPassRatio = _votingPassRatio;
        emit VotingPassRatioUpdated(_votingPassRatio);
    }

    function updatePoolFactory(address _poolFactory) 
        public
        onlyOwner
    {
        _updatePoolFactory(_poolFactory);
    }

    function _updatePoolFactory(address _poolFactory) 
        internal
    {
        require(_poolFactory != address(0), "Zero address not allowed");
        poolFactory = IPoolFactory(_poolFactory);
        emit PoolFactoryUpdated(_poolFactory);
    }
}
