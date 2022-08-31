// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "contracts/interfaces/IGnosis.sol";
import "contracts/interfaces/ITrade.sol";
import "contracts/libraries/Fixed.sol";

import "contracts/fuzz/IFuzz.sol";
import "contracts/fuzz/AssetMock.sol";
import "contracts/fuzz/ERC20Fuzz.sol";
import "contracts/fuzz/PriceModel.sol";
import "contracts/fuzz/TradeMock.sol";
import "contracts/fuzz/Utils.sol";
import "contracts/fuzz/FuzzP1.sol";

// MainP1Fuzz is both the MainP1 contract implementation, and the P1 "deployment"
// It constructs and initializes the P1 components found in FuzzP1.

contract MainP1Fuzz is IMainFuzz, MainP1 {
    using EnumerableSet for EnumerableSet.AddressSet;

    // Mock-specific singleton contracts in the deployment
    IMarketMock public marketMock;

    EnumerableSet.AddressSet internal aliasedAddrs;
    mapping(address => address) public aliases; // The map of senders

    IERC20[] public tokens; // token addresses, not including RSR or RToken
    mapping(bytes32 => IERC20) public tokensBySymbol;
    address[] public users; // "registered" user addresses
    address[] public constAddrs; // constant addresses, for "addrById"

    // ==== Scenario handles ====
    // Components and mocks that rely on _msgSender use this to implement msg.sender-with-aliases,
    // allowing the spoof() and unspoof() functions to work.
    function translateAddr(address addr) public view returns (address) {
        return aliasedAddrs.contains(addr) ? aliases[addr] : addr;
    }

    // From now on, translateAddr will pretend that `realSender` is `pretendSender`
    function spoof(address realSender, address pretendSender) external {
        aliasedAddrs.add(realSender);
        aliases[realSender] = pretendSender;
    }

    // Stop pretending that `realSender` is some other address
    function unspoof(address realSender) external {
        aliasedAddrs.remove(realSender);
        aliases[realSender] = address(0);
    }

    // Debugging getter
    function aliasValues() external view returns (address[] memory from, address[] memory to) {
        from = aliasedAddrs.values();
        to = new address[](aliasedAddrs.length());
        for (uint256 i = 0; i < aliasedAddrs.length(); i++) {
            to[i] = aliases[aliasedAddrs.at(i)];
        }
    }

    function numTokens() public view returns (uint256) {
        return tokens.length;
    }

    // Add a token to this system's tiny token registry
    function addToken(IERC20 token) public {
        tokens.push(token);
        bytes32 symbol = bytes32(bytes(IERC20Metadata(address(token)).symbol()));
        tokensBySymbol[symbol] = token;
    }

    function tokenBySymbol(string calldata symbol) public view returns (IERC20) {
        return tokensBySymbol[bytes32(bytes(symbol))];
    }

    function someToken(uint256 seed) public view returns (IERC20) {
        uint256 id = seed % (tokens.length + 2);
        if (id < tokens.length) return tokens[id];
        else id -= tokens.length;

        if (id == 0) return IERC20(address(rsr));
        if (id == 1) return IERC20(address(rToken));
        revert("invalid id in someToken");
    }

    function numUsers() public view returns (uint256) {
        return users.length;
    }

    function addUser(address user) public {
        users.push(user);
    }

    function someUser(uint256 seed) public view returns (address) {
        return users[seed % users.length];
    }

    function someAddr(uint256 seed) public view returns (address) {
        // constAddrs.length: constant addresses, mostly deployed contracts
        // numUsers: addresses from the user registry
        // 1: broker's "last deployed address"
        uint256 numIDs = numUsers() + constAddrs.length + 1;
        uint256 id = seed % numIDs;

        if (id < numUsers()) return users[id];
        else id -= numUsers();

        if (id < constAddrs.length) return constAddrs[id];
        else id -= constAddrs.length;

        if (id == 0) return address(BrokerP1Fuzz(address(broker)).lastOpenedTrade());
        revert("invalid id in someAddr");
    }

    constructor() {
        // Construct components
        rsr = new ERC20Fuzz("Reserve Rights", "RSR", this);
        rToken = new RTokenP1Fuzz();
        stRSR = new StRSRP1Fuzz();
        assetRegistry = new AssetRegistryP1Fuzz();
        basketHandler = new BasketHandlerP1Fuzz();
        backingManager = new BackingManagerP1Fuzz();
        distributor = new DistributorP1Fuzz();
        rsrTrader = new RevenueTraderP1Fuzz();
        rTokenTrader = new RevenueTraderP1Fuzz();
        furnace = new FurnaceP1Fuzz();
        broker = new BrokerP1Fuzz();

        constAddrs.push(address(rsr));
        constAddrs.push(address(rToken));
        constAddrs.push(address(assetRegistry));
        constAddrs.push(address(basketHandler));
        constAddrs.push(address(backingManager));
        constAddrs.push(address(distributor));
        constAddrs.push(address(rsrTrader));
        constAddrs.push(address(rTokenTrader));
        constAddrs.push(address(furnace));
        constAddrs.push(address(broker));
        constAddrs.push(address(0));
        constAddrs.push(address(1));
        constAddrs.push(address(2));
    }

    // Initialize self and components
    // Avoiding overloading here, just because it's super annoying to deal with in ethers.js
    function initFuzz(DeploymentParams memory params, IMarketMock marketMock_)
        public
        virtual
        initializer
    {
        // ==== Init self ====
        __Auth_init(params.shortFreeze, params.longFreeze);
        __UUPSUpgradeable_init();
        emit MainInitialized();

        marketMock = marketMock_;

        // Pretend to be the OWNER during the remaining initialization
        assert(hasRole(OWNER, _msgSender()));
        this.spoof(address(this), _msgSender());

        // ==== Initialize components ====
        // This is pretty much the matching section from p1/Deployer.sol
        rToken.init(
            this,
            "RToken",
            "Rtkn",
            "fnord",
            params.issuanceRate,
            params.maxRedemptionCharge,
            params.redemptionVirtualSupply
        );
        stRSR.init(
            this,
            "Staked RSR",
            "stRSR",
            params.unstakingDelay,
            params.rewardPeriod,
            params.rewardRatio
        );

        backingManager.init(
            this,
            params.tradingDelay,
            params.backingBuffer,
            params.maxTradeSlippage
        );

        basketHandler.init(this);
        rsrTrader.init(this, rsr, params.maxTradeSlippage);
        rTokenTrader.init(this, IERC20(address(rToken)), params.maxTradeSlippage);

        // Init Asset Registry, with default assets for all tokens
        IAsset[] memory assets = new IAsset[](2);
        assets[0] = new AssetMock(
            IERC20Metadata(address(rsr)),
            IERC20Metadata(address(0)),
            params.rTokenTradingRange,
            PriceModel({ kind: Kind.Walk, curr: 1e18, low: 0.5e18, high: 2e18 })
        );
        assets[1] = new RTokenAsset(IRToken(address(rToken)), params.rTokenTradingRange);
        assetRegistry.init(this, assets);

        // Init Distributor
        distributor.init(this, params.dist);

        // Init Furnace
        furnace.init(this, params.rewardPeriod, params.rewardRatio);

        // Init Broker
        // `tradeImplmentation` and `gnosis` are unused in BrokerP1Fuzz
        broker.init(this, IGnosis(address(0)), ITrade(address(0)), params.auctionLength);

        this.unspoof(address(this));
    }
}