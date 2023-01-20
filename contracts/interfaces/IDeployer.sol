pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "./IAsset.sol";
import "./IDistributor.sol";
import "./IGnosis.sol";
import "./IMain.sol";
import "./IRToken.sol";
import "./IStRSR.sol";
import "./ITrade.sol";
import "./IVersioned.sol";


struct DeploymentParams {
   
    RevenueShare dist;
   
   
    uint192 minTradeVolume;
    uint192 rTokenMaxTradeVolume;
   
   
    uint48 shortFreeze;
    uint48 longFreeze;
   
   
    uint192 rewardRatio;
    uint48 rewardPeriod;
   
   
    uint48 unstakingDelay;
   
   
    uint48 tradingDelay;
    uint48 auctionLength;
    uint192 backingBuffer;
    uint192 maxTradeSlippage;
   
   
    uint192 issuanceRate;
    uint192 scalingRedemptionRate;
    uint256 redemptionRateFloor;
}

struct Implementations {
    IMain main;
    Components components;
    ITrade trade;
}

interface IDeployer is IVersioned {
   
   
   
   
   
   
    event RTokenCreated(
        IMain indexed main,
        IRToken indexed rToken,
        IStRSR stRSR,
        address indexed owner,
        string version
    );

   
   
   
   
   
   
   
   
   
    function deploy(
        string calldata name,
        string calldata symbol,
        string calldata mandate,
        address owner,
        DeploymentParams calldata params
    ) external returns (address);
}

interface TestIDeployer is IDeployer {
   
   
    function ENS() external view returns (string memory);

    function rsr() external view returns (IERC20Metadata);

    function gnosis() external view returns (IGnosis);

    function rsrAsset() external view returns (IAsset);
}
