pragma solidity ^0.6.6;

import "../libraries/TokenConservation.sol";
import "../libraries/IdToAddressBiMap.sol";
import "../libraries/IterableAppendOnlySet.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";
import "../test/ERC20.sol";
import "./EpochTokenLocker.sol";

/** @title BatchExchange - A decentralized exchange for any ERC20 token as a multi-token batch
 *  auction with uniform clearing prices.
 *  For more information visit: <https://github.com/gnosis/dex-contracts>
 *  @author @gnosis/dfusion-team <https://github.com/orgs/gnosis/teams/dfusion-team/members>
 */
contract BatchExchange is EpochTokenLocker {
    using SafeCast for uint256;
    using SafeMath for uint128;
    using BytesLib for bytes32;
    using BytesLib for bytes;
    using TokenConservation for int256[];
    using TokenConservation for uint16[];
    using IterableAppendOnlySet for IterableAppendOnlySet.Data;

    /** @dev Maximum number of touched orders in auction (used in submitSolution) */
    uint256 public constant MAX_TOUCHED_ORDERS = 30;

    /** @dev maximum number of tokens that can be listed for exchange */
    // solhint-disable-next-line var-name-mixedcase
    uint256 public MAX_TOKENS = 100;

    /** @dev Current number of tokens listed/available for exchange */
    uint16 public numTokens;

    /** @dev The feeToken of the exchange will be the OWL Token */
    ERC20 public feeToken;

    /** @dev mapping of type userAddress -> List[Order] where all the user's orders are stored */
    mapping(address => Order[]) public orders;

    /** @dev mapping of type tokenId -> curentPrice of tokenId */
    mapping(uint16 => uint128) public currentPrices;

    // Iterable set of all users, required to collect auction information
    IterableAppendOnlySet.Data private allUsers;
    IdToAddressBiMap.Data private registeredTokens;

    struct Order {
        uint16 buyToken;
        uint16 sellToken;
        uint32 validFrom; // order is valid from auction collection period: validFrom inclusive
        uint32 validUntil; // order is valid till auction collection period: validUntil inclusive
        uint128 priceNumerator;
        uint128 priceDenominator;
        uint128 usedAmount; // remainingAmount = priceDenominator - usedAmount
    }

    event OrderPlacement(
        address indexed owner,
        uint16 index,
        uint16 indexed buyToken,
        uint16 indexed sellToken,
        uint32 validFrom,
        uint32 validUntil,
        uint128 priceNumerator,
        uint128 priceDenominator
    );

    event TokenListing(address token, uint16 id);

    /** @dev Event emitted when an order is cancelled but still valid in the batch that is
     * currently being solved. It remains in storage but will not be tradable in any future
     * batch to be solved.
     */
    event OrderCancellation(address indexed owner, uint16 id);

    /** @dev Event emitted when an order is removed from storage.
     */
    event OrderDeletion(address indexed owner, uint16 id);

    /** @dev Constructor determines exchange parameters
     * @param _feeToken Address of ERC20 fee token.
     */
    constructor(address _feeToken) public {
        // All solutions for the batches must have normalized prices. The following line sets the
        // price of OWL to 10**18 for all solutions and hence enforces a normalization.
        currentPrices[0] = 1 ether;
        feeToken = ERC20(_feeToken);
        // The burn functionallity of OWL requires an approval.
        // In the following line the approval is set for all future burn calls.
        feeToken.approve(address(this), uint256(-1));
        addToken(_feeToken); // feeToken will always have the token index 0
    }

    /** @dev Used to list a new token on the contract: Hence, making it available for exchange in an auction.
     * @param token ERC20 token to be listed.
     *
     * Requirements:
     * - `maxTokens` has not already been reached
     * - `token` has not already been added
     */
    function addToken(address token) public {
        require(numTokens < MAX_TOKENS, "Max tokens reached");
        require(IdToAddressBiMap.insert(registeredTokens, numTokens, token), "Token already registered");
        emit TokenListing(token, numTokens);
        numTokens++;
    }

    /** @dev A user facing function used to place limit sell orders in auction with expiry defined by batchId
     * @param buyToken id of token to be bought
     * @param sellToken id of token to be sold
     * @param validUntil batchId representing order's expiry
     * @param buyAmount relative minimum amount of requested buy amount
     * @param sellAmount maximum amount of sell token to be exchanged
     * @return orderId defined as the index in user's order array
     *
     * Emits an {OrderPlacement} event with all relevant order details.
     */
    function placeOrder(
        uint16 buyToken,
        uint16 sellToken,
        uint32 validUntil,
        uint128 buyAmount,
        uint128 sellAmount
    ) public returns (uint256) {
        return placeOrderInternal(buyToken, sellToken, getCurrentBatchId(), validUntil, buyAmount, sellAmount);
    }

    /** @dev a user facing function used to cancel orders. If the order is valid for the batch that is currently
     * being solved, it sets order expiry to that batchId. Otherwise it removes it from storage. Can be called
     * multiple times (e.g. to eventually free storage once order is expired).
     *
     * @param orderIds referencing the indices of user's orders to be cancelled
     *
     * Emits an {OrderCancellation} or {OrderDeletion} with sender's address and orderId
     */
    function cancelOrders(uint16[] memory orderIds) public {
        uint32 batchIdBeingSolved = getCurrentBatchId() - 1;
        for (uint16 i = 0; i < orderIds.length; i++) {
            if (!checkOrderValidity(orders[msg.sender][orderIds[i]], batchIdBeingSolved)) {
                delete orders[msg.sender][orderIds[i]];
                emit OrderDeletion(msg.sender, orderIds[i]);
            } else {
                orders[msg.sender][orderIds[i]].validUntil = batchIdBeingSolved;
                emit OrderCancellation(msg.sender, orderIds[i]);
            }
        }
    }

    /**
     * Public View Methods
     */
    /** @dev View returning ID of listed tokens
     * @param addr address of listed token.
     * @return tokenId as stored within the contract.
     */
    function tokenAddressToIdMap(address addr) public view returns (uint16) {
        return IdToAddressBiMap.getId(registeredTokens, addr);
    }

    /** @dev View returning address of listed token by ID
     * @param id tokenId as stored, via BiMap, within the contract.
     * @return address of (listed) token
     */
    function tokenIdToAddressMap(uint16 id) public view returns (address) {
        return IdToAddressBiMap.getAddressAt(registeredTokens, id);
    }

    /** @dev View returning a bool attesting whether token was already added
     * @param addr address of the token to be checked
     * @return bool attesting whether token was already added
     */
    function hasToken(address addr) public view returns (bool) {
        return IdToAddressBiMap.hasAddress(registeredTokens, addr);
    }

    // Private pure
    /** @dev used to determine if an order is valid for specific auction/batch
     * @param order object whose validity is in question
     * @param batchId auction index of validity
     * @return true if order is valid in auction batchId else false
     */
    function checkOrderValidity(Order memory order, uint32 batchId) private pure returns (bool) {
        return order.validFrom <= batchId && order.validUntil >= batchId;
    }

    /**
     * Private Functions
     */
    function placeOrderInternal(
        uint16 buyToken,
        uint16 sellToken,
        uint32 validFrom,
        uint32 validUntil,
        uint128 buyAmount,
        uint128 sellAmount
    ) private returns (uint16) {
        require(IdToAddressBiMap.hasId(registeredTokens, buyToken), "Buy token must be listed");
        require(IdToAddressBiMap.hasId(registeredTokens, sellToken), "Sell token must be listed");
        require(buyToken != sellToken, "Exchange tokens not distinct");
        require(validFrom >= getCurrentBatchId(), "Orders can't be placed in the past");
        orders[msg.sender].push(
            Order({
                buyToken: buyToken,
                sellToken: sellToken,
                validFrom: validFrom,
                validUntil: validUntil,
                priceNumerator: buyAmount,
                priceDenominator: sellAmount,
                usedAmount: 0
            })
        );
        uint16 orderId = (orders[msg.sender].length - 1).toUint16();
        emit OrderPlacement(msg.sender, orderId, buyToken, sellToken, validFrom, validUntil, buyAmount, sellAmount);
        allUsers.insert(msg.sender);
        return orderId;
    }
}
