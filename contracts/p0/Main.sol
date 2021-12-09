pragma solidity 0.8.9;
// SPDX-License-Identifier: BlueOak-1.0.0

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/main/SettingsHandler.sol";
import "contracts/p0/main/Moody.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/main/DefaultHandler.sol";
import "contracts/p0/main/RevenueHandler.sol";
import "contracts/p0/main/RTokenIssuer.sol";
import "contracts/p0/main/Auctioneer.sol";
import "contracts/p0/main/AssetRegistry.sol";
import "contracts/p0/main/VaultHandler.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/Pausable.sol";

/**
 * @title Main
 * @notice Collects all mixins.
 */
contract MainP0 is
    Ownable,
    Mixin,
    AssetRegistryP0,
    SettingsHandlerP0,
    RevenueDistributorP0,
    VaultHandlerP0,
    DefaultHandlerP0,
    AuctioneerP0,
    RevenueHandlerP0,
    RTokenIssuerP0,
    IMain
{
    using FixLib for Fix;

    /// Constructor-as-function
    /// Idempotent
    function init(ConstructorArgs calldata args)
        public
        virtual
        override(
            IMixin,
            Mixin,
            AssetRegistryP0,
            SettingsHandlerP0,
            RevenueDistributorP0,
            VaultHandlerP0,
            DefaultHandlerP0,
            AuctioneerP0,
            RevenueHandlerP0,
            RTokenIssuerP0
        )
    {
        super.init(args);
    }

    /// A central mutator that causes all mixins to act
    function poke()
        public
        virtual
        override(IMixin, Mixin, DefaultHandlerP0, AuctioneerP0, RevenueHandlerP0, RTokenIssuerP0)
    {
        super.poke();
    }

    /// An idempotent mutator for updating accounting metrics
    /// Unlike `poke`, no external side-effects
    function beforeUpdate()
        public
        virtual
        override(
            IMixin,
            Mixin,
            AssetRegistryP0,
            SettingsHandlerP0,
            RevenueDistributorP0,
            VaultHandlerP0,
            DefaultHandlerP0,
            AuctioneerP0,
            RevenueHandlerP0,
            RTokenIssuerP0
        )
    {
        super.beforeUpdate();
    }
}