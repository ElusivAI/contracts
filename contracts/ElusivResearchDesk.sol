// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

/// @title Elusiv Research Desk
/// @notice Manages research requests paid in ELUSIV tokens.
/// @dev Requests are stored on-chain and fulfilled by the contract owner.
contract ElusivResearchDesk is Ownable, ReentrancyGuard {
  using SafeERC20 for IERC20;

  uint256 public constant DEFAULT_MAX_QUERY_LENGTH = 512;

  struct ResearchRequest {
    address requester;
    string query;
    string response;
    uint256 payment;
    uint256 createdAt;
    uint256 updatedAt;
    bool fulfilled;
  }

  IERC20 public immutable elusivToken;
  uint256 public requestCost;
  uint256 public immutable maxQueryLength;
  ResearchRequest[] private _requests;
  uint256[] private _openRequestIds;

  mapping(uint256 => uint256) private _openRequestIndex;
  mapping(address => uint256[]) private _pendingByUser;
  mapping(address => mapping(uint256 => uint256)) private _pendingIndexByUser;

  event RequestSubmitted(uint256 indexed requestId, address indexed requester, string query, uint256 payment);
  event RequestCompleted(uint256 indexed requestId, string response, address indexed resolver);
  event RequestCostUpdated(uint256 newCost, address indexed updater);
  event FundsWithdrawn(address indexed to, uint256 amount);

  error InvalidRequest();
  error InvalidRequester();

  /// @notice Initializes the research desk.
  /// @param tokenAddress The ELUSIV token contract address.
  /// @param initialCost The cost in tokens per research request.
  /// @param maxQueryLen The maximum length of the query string in bytes.
  constructor(address tokenAddress, uint256 initialCost, uint256 maxQueryLen) Ownable(msg.sender) {
    require(tokenAddress != address(0), 'Token required');
    elusivToken = IERC20(tokenAddress);
    requestCost = initialCost;
    maxQueryLength = maxQueryLen == 0 ? DEFAULT_MAX_QUERY_LENGTH : maxQueryLen;
    emit RequestCostUpdated(initialCost, msg.sender);
  }

  /// @notice Updates the cost for a research request.
  /// @param newCost The new cost in tokens.
  function setRequestCost(uint256 newCost) external onlyOwner {
    requestCost = newCost;
    emit RequestCostUpdated(newCost, msg.sender);
  }

  /// @notice Submits a new research request.
  /// @dev Transfers tokens from sender to this contract. Sender must approve tokens first.
  /// @param query The research question or topic.
  /// @return requestId The unique ID of the created request.
  function requestResearch(string calldata query) external nonReentrant returns (uint256 requestId) {
    uint256 qLength = bytes(query).length;
    require(qLength > 0, 'Query required');
    require(qLength <= maxQueryLength, 'Query too long');
    uint256 cost = requestCost;
    require(cost > 0, 'Requests disabled');
    address requester = msg.sender;

    requestId = _requests.length;
    _requests.push(
      ResearchRequest({
        requester: requester,
        query: query,
        response: '',
        payment: cost,
        createdAt: block.timestamp,
        updatedAt: block.timestamp,
        fulfilled: false
      })
    );
    _trackPending(requestId, requester);
    emit RequestSubmitted(requestId, requester, query, cost);

    elusivToken.safeTransferFrom(requester, address(this), cost);
  }

  /// @notice Mark a request as complete with a response.
  /// @param requestId The ID of the request to complete.
  /// @param response The answer or link to the research.
  function completeRequest(uint256 requestId, string calldata response) external onlyOwner {
    ResearchRequest storage req = _getRequest(requestId);
    require(!req.fulfilled, 'Already fulfilled');
    req.fulfilled = true;
    req.response = response;
    req.updatedAt = block.timestamp;
    _untrackPending(requestId, req.requester);
    emit RequestCompleted(requestId, response, msg.sender);
  }

  /// @notice Returns the total number of requests made.
  function totalRequests() external view returns (uint256) {
    return _requests.length;
  }

  /// @notice Gets the details of a specific request.
  /// @param requestId The ID of the request.
  function getRequest(uint256 requestId) external view returns (ResearchRequest memory) {
    return _getRequest(requestId);
  }

  /// @notice Returns a paginated list of requests.
  /// @param offset The starting index.
  /// @param limit The number of requests to return.
  function getRequests(uint256 offset, uint256 limit) external view returns (ResearchRequest[] memory results) {
    uint256 total = _requests.length;
    if (offset >= total) {
      return new ResearchRequest[](0);
    }
    uint256 end = offset + limit;
    if (end > total) end = total;
    uint256 length = end - offset;
    results = new ResearchRequest[](length);
    for (uint256 i = 0; i < length; i++) {
      results[i] = _requests[offset + i];
    }
  }

  /// @notice Returns all currently pending (unfulfilled) requests.
  function getPendingRequests() external view returns (ResearchRequest[] memory pending) {
    uint256 length = _openRequestIds.length;
    pending = new ResearchRequest[](length);
    for (uint256 i = 0; i < length; i++) {
      pending[i] = _requests[_openRequestIds[i]];
    }
  }

  /// @notice Returns all pending requests for a specific user.
  /// @param requester The user address.
  function getPendingRequestsFor(address requester) external view returns (ResearchRequest[] memory pending) {
    if (requester == address(0)) revert InvalidRequester();
    uint256[] storage ids = _pendingByUser[requester];
    uint256 length = ids.length;
    pending = new ResearchRequest[](length);
    for (uint256 i = 0; i < length; i++) {
      pending[i] = _requests[ids[i]];
    }
  }

  /// @notice Withdraws tokens from the contract to a recipient.
  /// @param to The recipient address.
  /// @param amount The amount of tokens to withdraw.
  function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
    require(to != address(0), 'Invalid recipient');
    elusivToken.safeTransfer(to, amount);
    emit FundsWithdrawn(to, amount);
  }

  function _trackPending(uint256 requestId, address requester) internal {
    _openRequestIndex[requestId] = _openRequestIds.length;
    _openRequestIds.push(requestId);

    uint256[] storage userList = _pendingByUser[requester];
    _pendingIndexByUser[requester][requestId] = userList.length;
    userList.push(requestId);
  }

  function _untrackPending(uint256 requestId, address requester) internal {
    // global list
    uint256 openIdx = _openRequestIndex[requestId];
    uint256 lastOpenIdx = _openRequestIds.length - 1;
    if (openIdx != lastOpenIdx) {
      uint256 lastRequestId = _openRequestIds[lastOpenIdx];
      _openRequestIds[openIdx] = lastRequestId;
      _openRequestIndex[lastRequestId] = openIdx;
    }
    _openRequestIds.pop();
    delete _openRequestIndex[requestId];

    // user list
    uint256 userIdx = _pendingIndexByUser[requester][requestId];
    uint256 lastUserIdx = _pendingByUser[requester].length - 1;
    if (userIdx != lastUserIdx) {
      uint256 lastId = _pendingByUser[requester][lastUserIdx];
      _pendingByUser[requester][userIdx] = lastId;
      _pendingIndexByUser[requester][lastId] = userIdx;
    }
    _pendingByUser[requester].pop();
    delete _pendingIndexByUser[requester][requestId];
  }

  function _getRequest(uint256 requestId) internal view returns (ResearchRequest storage) {
    if (requestId >= _requests.length) revert InvalidRequest();
    return _requests[requestId];
  }
}
