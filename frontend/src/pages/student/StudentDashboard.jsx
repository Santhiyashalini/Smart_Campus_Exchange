import { useState, useEffect, useMemo, useCallback } from "react";
import "./StudentDashboard.css";
import { useNavigate, useLocation } from "react-router-dom";
import StudentNavbar, { STUDENT_NAV_TABS } from "./StudentNavbar";
import { getProfile } from "../../services/profileService";
import SellerProfileSection from "./sections/SellerProfileSection";
import {
  getBrowseProducts,
  getMyProducts,
  addProduct,
  updateProduct,
  deleteProduct,
  uploadProductImages,
  deleteProductImage,
  setPrimaryImage,
} from "../../services/productService";

import {
  createRequest,
  getMyRequests,
  getIncomingRequests,
  deleteRequest,
} from "../../services/requestService";

import {
  getPickupByRequestId,
  confirmSchedule,
  requestReschedule,
  confirmProductReceived,
  reportDeliveryIssue,
  rateSeller,
} from "../../services/pickupService";

import {
  getMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
 
} from "../../services/notificationService";

import {
  getMyComplaints,
  getComplaintsAgainstMe,
} from "../../services/complaintService";

import { FaUser, FaCheckCircle } from "react-icons/fa";

import {
  SIDEBAR_ITEMS,
  COMPLAINTS_SIDEBAR_GROUP,
  PROFILE_IMAGE_BASE_URL,
  HISTORY_STORAGE_KEYS,
 
  SAMPLE_COMPLAINTS_AGAINST_ME,
  TYPE_INFO,
  COMPLAINT_STATUS,
} from "./constants";
import { loadHistory, getRecommendations, mapBackendProduct } from "./utils/DashboardUtils";

import ConfirmDialog from "./components/ConfirmDialog";
import SelectExchangeItemModal from "./components/SelectExchangeItemModal";

import BrowseProductsSection from "./sections/BrowseProductsSection";
import MyProductsSection from "./sections/MyProductsSection";
import MyRequestsSection from "./sections/MyRequestsSection";
import MyPurchasesSection from "./sections/MyPurchasesSection";
import MyComplaintsSection from "./sections/MyComplaintsSection";
import RaiseComplaintSection from "./sections/RaiseComplaintSection";
import ComplaintsAgainstMeSection from "./sections/ComplaintsAgainstMeSection";
import IncomingRequestsSection from "./sections/IncomingRequestsSection";
import NotificationsSection from "./sections/NotificationsSection";
import ProductDetailSection from "./sections/ProductDetailSection";
import ProductFormPage from "./sections/ProductFormPage";

/* ---------------------------------------------------------
   Main dashboard page — owns all state and simply renders
   whichever section/sub-view is active.

   REQUEST WORKFLOW (Sell / Donate / Exchange all share this):
     1. Buyer sends a request                       -> PENDING
        (Exchange only: buyer must first pick an
         item from My Purchases to offer)
     2. Seller reviews it, in Incoming Requests:
          - Accept -> must supply pickup location
            + date/time in the same step  -> Request stays ACCEPTED,
            a PickupSchedule is created with pickupStatus SCHEDULED
          - Reject -> Request becomes REJECTED
     3. Buyer reviews the proposed pickup, in My Requests:
          - Confirm  -> pickupStatus becomes CONFIRMED
          - Request a different time -> pickupStatus becomes
            RESCHEDULE_REQUESTED (with a reason the seller can see);
            seller re-proposes, which resets pickupStatus back to
            SCHEDULED for the buyer to review again
     4. On the day of, the seller marks it handed over at the meetup
        (only allowed once pickupStatus is CONFIRMED) ->
        pickupStatus becomes BUYER_CONFIRMATION_PENDING
     5. Buyer confirms receipt -> pickupStatus becomes COMPLETED
        (this is what makes it show up in My Purchases), or reports
        a delivery issue -> pickupStatus becomes DELIVERY_ISSUE and
        a complaint is auto-filed against the seller.
     6. Once COMPLETED, the buyer can rate the seller (once) from My
        Purchases, and/or click "Report a problem" there, which
        routes into the same Raise Complaint flow used everywhere
        else (see handleGoToComplaint / raiseComplaintTarget below)
        rather than a separate modal.
     See handleConfirmSchedule / handleRequestReschedule /
     handleConfirmReceived / handleReportDeliveryIssue below, and the
     myPurchases filter — all check the REAL backend pickup status,
     not a mock Request.status value.

   NOTE on product completion: when confirmProductReceived() finishes
   on the backend, it also flips the underlying Product's status to
   SOLD / EXCHANGED / DONATED and transfers ownership — see
   ProductService.ACQUIRED_STATUSES and
   PickupScheduleServiceImpl.confirmProductReceived() on the backend.
   handleConfirmReceived below refreshes both myRequests AND
   myProducts for that reason — the buyer's own myProducts can change
   too (their offered item, in an Exchange), not just myRequests.

   NOTE on admin product moderation: when an admin blocks a product,
   the backend sets its status to BLOCKED and creates a
   PRODUCT_BLOCKED notification for the seller (relatedId = product
   id). Unblocking sets it back to AVAILABLE and creates
   PRODUCT_UNBLOCKED. Blocked products are filtered out of Browse
   Products below, but still show up in the seller's My Products.
   Clicking the notification opens that product's detail page, where
   Edit / Delete are hidden while it is blocked.
--------------------------------------------------------- */

// Every id that renderMain()'s switch actually knows how to render.
// Anything else (stale location.state, a renamed sidebar id, a typo
// in a caller passing navigate(..., { state: { section } })) must
// NOT be trusted blindly — otherwise mainSection can end up holding
// a value with no matching case, renderMain() falls through to
// `default`, and the whole content area silently goes blank while
// the navbar/sidebar still render fine. That's the "dashboard
// sometimes doesn't show up" bug.
const VALID_SECTIONS = [
  "products",
  "incomingRequests",
  "notifications",
  "myProducts",
  "myRequests",
  "myPurchases",
  "myComplaints",
  "raiseComplaint",
  "complaintsAgainstMe",
];

// How often the notifications list is re-fetched, so a notification
// created by another user/admin (e.g. PRODUCT_BLOCKED) shows up
// without the student having to reload the page.
const NOTIFICATION_POLL_INTERVAL_MS = 30000;

// NEW: true when the admin has blocked this product.
const isProductBlocked = (p) =>
  String(p?.status).toUpperCase() === "BLOCKED";

const mapBackendRequest = (r) => ({
  id: r.id,

  productId:
    r.productId ??
    r.product?.id,

  productName:
    r.productTitle ??
    r.product?.title ??
    "Untitled listing",

  productImage:
    r.productImage ??
    r.product?.images?.[0]?.imageUrl ??
    r.product?.images?.[0]?.url ??
    null,

  category:
    r.category ??
    r.product?.category ??
    "",

  sellerId:
    r.sellerId ??
    r.seller?.studentId,

  sellerName:
    r.sellerName ??
    r.seller?.fullName ??
    "Unknown Seller",

  requesterId:
    r.requesterId ??
    r.requester?.studentId,

  requesterName:
    r.requesterName ??
    r.requester?.fullName ??
    "Unknown Student",

  requestType:
    r.requestType,

  type:
    r.productType ??
    r.product?.type ??
    (r.requestType === "EXCHANGE"
      ? "Exchange"
      : r.requestType === "DONATE"
      ? "Donate"
      : "Sell"),

  price:
    r.productPrice ??
    r.product?.price ??
    0,

  message:
    r.message ??
    "",

  offeredProduct:
    r.offeredProduct ??
    null,

  status:
    r.status ??
    "PENDING",

  pickupLocation:
    r.pickupLocation ??
    null,

  pickupDate:
    r.pickupDate ??
    null,

  pickupTime:
    r.pickupTime ??
    null,

  // Real signal for where the pickup is in its lifecycle:
  // SCHEDULED / RESCHEDULE_REQUESTED / CONFIRMED /
  // BUYER_CONFIRMATION_PENDING / DELIVERY_ISSUE / COMPLETED.
  // myPurchases filters on this reaching COMPLETED.
  pickupStatus:
    r.pickupStatus ??
    null,

  // Only populated while pickupStatus === RESCHEDULE_REQUESTED — the
  // buyer's explanation for why the proposed time didn't work, shown
  // to the seller in Incoming Requests.
  rescheduleReason:
    r.rescheduleReason ??
    null,

  // Comes from the real backend field; the in-memory myRatings state
  // is only a same-session fallback.
  myRating:
    r.myRating ??
    null,

  time:
    r.createdAt
      ? new Date(r.createdAt).getTime()
      : Date.now(),

  updatedAt:
    r.updatedAt ??
    null,
});
const mapBackendComplaint = (complaint) => ({
  id:
    complaint.complaintId,

  productId:
    complaint.productId,

  productName:
    complaint.productTitle ||
    "Unknown Product",

 productImage:
    complaint.productImage ||
    complaint.imageUrl ||
    null,

  requestId:
    complaint.requestId,

  complaintType:
    complaint.complaintType,

  description:
    complaint.description,

  status:
    complaint.status,

  createdAt:
    complaint.createdAt
      ? new Date(
          complaint.createdAt
        ).getTime()
      : Date.now(),

  resolvedAt:
    complaint.resolvedAt
      ? new Date(
          complaint.resolvedAt
        ).getTime()
      : null,

  studentId:
    complaint.studentId,

  studentName:
    complaint.studentName,

  againstStudentId:
    complaint.againstStudentId,

  againstStudentName:
    complaint.againstStudentName,

  // Visible once status is RESOLVED — the admin's note, shown to the
  // student who filed the complaint.
  resolutionNote:
    complaint.resolutionNote ??
    null,

  // Only set when the admin issued a warning alongside resolving —
  // shown to the student the complaint was raised against, i.e. this
  // only ever has content on ComplaintsAgainstMeSection cards, never
  // on MyComplaintsSection ones.
  warningNote:
    complaint.warningNote ??
    null,
});

// The backend doesn't send a `message` for notifications, so this is
// the text the seller actually sees. Any notifyType missing from this
// switch shows "You have a new notification."
const getNotificationMessage = (type) => {

  switch (type) {

    case "REQUEST_RECEIVED":
      return "You received a new request.";

    case "REQUEST_ACCEPTED":
      return "Your request has been accepted.";

    case "REQUEST_REJECTED":
      return "Your request has been rejected.";

    case "REQUEST_CANCELLED":
      return "A request has been cancelled.";

    case "PICKUP_SCHEDULED":
      return "A pickup schedule has been proposed.";

    case "PICKUP_CONFIRMED":
      return "The buyer confirmed the pickup schedule.";

    case "RESCHEDULE_REQUESTED":
      return "The buyer requested a different pickup time.";

    case "PICKUP_RESCHEDULED":
      return "The seller proposed a new pickup time.";

    case "BUYER_CONFIRMATION_REQUIRED":
      return "The seller marked the item as handed over — please confirm.";

    case "PICKUP_REMINDER":
      return "⏰ Pickup's almost here! Don't forget to swing by.";

    case "TRANSACTION_COMPLETED":
      return "A transaction was completed.";

    case "SELLER_RATED":
      return "You received a new rating.";

    case "DELIVERY_ISSUE_REPORTED":
      return "A delivery issue was reported.";

    case "COMPLAINT_RECEIVED":
      return "A new complaint has been raised against you.";

    case "COMPLAINT_UPDATED":
      return "Your complaint has been updated.";

    case "COMPLAINT_RESOLVED":
      return "Your complaint has been resolved.";

    case "SELLER_WARNING":
      return "An admin has issued a warning on your account — check Complaints Raised on Me for details.";

    case "PRODUCT_BLOCKED":
      return "Your product has been blocked by the admin.";

    case "PRODUCT_UNBLOCKED":
      return "Your product has been unblocked and is available again.";

    default:
      return "You have a new notification.";
  }
};

const mapBackendNotification = (notification) => ({
  id:
    notification.id ??
    notification.notifyId,

  notifyType:
    notification.notifyType,

  relatedId:
    notification.relatedId,

  read:
    notification.isRead ?? false,

  time:
    notification.createdAt
      ? new Date(notification.createdAt).getTime()
      : Date.now(),

  createdAt:
    notification.createdAt,

  message:
    notification.message ??
    getNotificationMessage(notification.notifyType),
});

// Spring's ResponseStatusException serializes as e.g.
// `400 BAD_REQUEST "This product is no longer available"` on the
// `message` field. This strips the status-code/reason-phrase prefix
// and surrounding quotes so every toast in this file shows just the
// human-readable part, whichever endpoint the 400 came from.
// Always logs the raw error.response?.data too, so the real backend
// message is visible in the console even for calls that don't
// specifically log it themselves.
const extractErrorMessage = (error, fallback) => {
  console.error("Request failed:", error, error.response?.data);

  const rawMessage = error.response?.data?.message;
  if (!rawMessage) return fallback;

  return rawMessage
    .replace(/^\d{3}\s+[A-Z_]+\s*/, "")
    .replace(/^"(.*)"$/, "$1");
};

function StudentDashboard() {
  const location = useLocation();

  const [mainSection, setMainSection] = useState(() => {
    const requested = location.state?.section;
    return VALID_SECTIONS.includes(requested) ? requested : "products";
  });
  const [subView, setSubView] = useState(null); // null | "detail" | "add" | "edit" | "sellerProfile"
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [viewedSeller, setViewedSeller] = useState(null); // { id, name, department, avatarUrl, trustScore }

  const [editingProduct, setEditingProduct] = useState(null);
  const [returnSection, setReturnSection] = useState("products");

  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer only
  const [toast, setToast] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Sell/Donate request confirmation (simple confirm — no item to pick)
  const [requestTarget, setRequestTarget] = useState(null);
  // Exchange request — buyer must pick an offered item first
  const [exchangeTarget, setExchangeTarget] = useState(null);

  const [products, setProducts] = useState([]);
  const [myProducts, setMyProducts] = useState([]);
  const [myRequests, setMyRequests] = useState([]);

  // Ratings the buyer has submitted this session, keyed by request id.
  const [myRatings, setMyRatings] = useState({});

  // Which purchase "Report a problem" was clicked on, so
  // RaiseComplaintSection can jump straight to step 2 for it instead
  // of making the person pick the transaction again.
  const [raiseComplaintTarget, setRaiseComplaintTarget] = useState(null);

  const [
  incomingRequests,
  setIncomingRequests
] = useState([]);
const loadMyRequests = useCallback(async () => {
  try {
    const data = await getMyRequests();

    const mappedRequests =
      (data || []).map(mapBackendRequest);

    setMyRequests(mappedRequests);

    return mappedRequests;

  } catch (error) {

    console.error(
      "Failed to load my requests:",
      error
    );

    return [];
  }
}, []);

useEffect(() => {
  loadMyRequests();
}, [loadMyRequests]);



const loadIncomingRequests =
  useCallback(async () => {

    try {

      const data =
        await getIncomingRequests();

      const mappedRequests =
        (data || []).map(
          mapBackendRequest
        );

      setIncomingRequests(
        mappedRequests
      );

      return mappedRequests;

    } catch (error) {

      console.error(
        "Failed to load incoming requests:",
        error
      );

      return [];

    }

  }, []);

  useEffect(() => {
  loadIncomingRequests();
}, [loadIncomingRequests]);

 const [complaints, setComplaints] = useState([]);

const [
  complaintsAgainstMe,
  setComplaintsAgainstMe
] = useState([]);
const loadMyComplaints =
  useCallback(async () => {

    try {

      const data =
        await getMyComplaints();

      const mappedComplaints =
        (data || []).map(
          mapBackendComplaint
        );

      setComplaints(
        mappedComplaints
      );

      return mappedComplaints;

    } catch (error) {

      console.error(
        "Failed to load my complaints:",
        error
      );

      return [];

    }

  }, []);


useEffect(() => {

  loadMyComplaints();

}, [
  loadMyComplaints
]);

const loadComplaintsAgainstMe =
  useCallback(async () => {

    try {

      const data =
        await getComplaintsAgainstMe();

      const mappedComplaints =
        (data || []).map(
          mapBackendComplaint
        );

      setComplaintsAgainstMe(
        mappedComplaints
      );

      return mappedComplaints;

    } catch (error) {

      console.error(
        "Failed to load complaints against me:",
        error
      );

      return [];

    }

  }, []);
  useEffect(() => {

  loadComplaintsAgainstMe();

}, [
  loadComplaintsAgainstMe
]);

const [notifications, setNotifications] = useState([]);

// Polls every NOTIFICATION_POLL_INTERVAL_MS instead of loading once
// on mount, so a notification created while the student is already on
// the dashboard (e.g. an admin blocking their product) appears
// without a page reload.
useEffect(() => {
  let cancelled = false;

  const loadNotifications = async () => {
    try {
      const data = await getMyNotifications();

      if (!cancelled) {
        setNotifications(
          (data || []).map(mapBackendNotification)
        );
      }
    } catch (error) {
      console.error(
        "Failed to load notifications:",
        error
      );
    }
  };

  loadNotifications();

  const intervalId = setInterval(
    loadNotifications,
    NOTIFICATION_POLL_INTERVAL_MS
  );

  return () => {
    cancelled = true;
    clearInterval(intervalId);
  };
}, []);
const [notificationTarget, setNotificationTarget] = useState(null);
  // ---------- Signed-in student's name + photo for the sidebar ----------
  const [studentProfile, setStudentProfile] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getProfile()
      .then((data) => {
        if (!cancelled) setStudentProfile(data);
      })
      .catch(() => {
        /* sidebar just falls back to a generic name/icon */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------- Product catalog ----------
  // ---------- Browse Products ----------


const loadBrowseProducts =
  useCallback(async () => {

    try {

      const data =
        await getBrowseProducts();

      // Blocked products (admin moderation) are dropped here as a
      // frontend safety net so buyers never see them in Browse. The
      // backend browse query should also return AVAILABLE only, and
      // RequestServiceImpl.addRequest() should reject BLOCKED
      // products — this filter alone doesn't stop a direct request.
      const mappedProducts =
        (data || [])
          .map(mapBackendProduct)
          .filter((p) => !isProductBlocked(p));

      setProducts(
        mappedProducts
      );

      return mappedProducts;

    } catch (error) {

      console.error(
        "Failed to load browse products:",
        error
      );

      return [];

    }

  }, []);

  useEffect(() => {
  loadBrowseProducts();
}, [loadBrowseProducts]);

  // ---------- My Products ----------
 
const loadMyProducts =
  useCallback(async () => {

    try {

      const data =
        await getMyProducts();

      const mappedProducts =
        (data || []).map(
          mapBackendProduct
        );

      setMyProducts(
        mappedProducts
      );

      return mappedProducts;

    } catch (error) {

      console.error(
        "Failed to load my products:",
        error
      );

      return [];

    }

  }, []);
  useEffect(() => {
  loadMyProducts();
}, [
  loadMyProducts
]);

  // ---------- Personalization signals ----------
  const [browsingHistory, setBrowsingHistory] = useState(() => loadHistory(HISTORY_STORAGE_KEYS.browsing));
  const [purchaseHistory, setPurchaseHistory] = useState(() => loadHistory(HISTORY_STORAGE_KEYS.purchase));

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEYS.browsing, JSON.stringify(browsingHistory));
    } catch {
      /* localStorage unavailable — recommendations just won't persist */
    }
  }, [browsingHistory]);

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEYS.purchase, JSON.stringify(purchaseHistory));
    } catch {
      /* localStorage unavailable — recommendations just won't persist */
    }
  }, [purchaseHistory]);

  const navigate = useNavigate();

  const marketplaceProducts = products;

  const recommendations = useMemo(
    () => getRecommendations(marketplaceProducts, browsingHistory, purchaseHistory, 6),
    [marketplaceProducts, browsingHistory, purchaseHistory]
  );

  // Every product this seller has listed, drawn from data already
  // fetched — browse products plus your own products (in case you
  // ever land on your own profile via this flow). Deduplicated by id
  // since a product could theoretically appear in both lists.
  const sellerProducts = useMemo(() => {
    if (!viewedSeller) return [];
    const combined = [...products, ...myProducts];
    const seen = new Set();
    return combined.filter((p) => {
      if (p.ownerId !== viewedSeller.id) return false;
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [products, myProducts, viewedSeller]);

  // "Purchases" = requests where the pickup was actually confirmed as
  // received by the buyer (pickupStatus === COMPLETED). Also the pool
  // Exchange offers are picked from — you can only offer something
  // you've actually received.
  const myPurchases = useMemo(
    () =>
      myRequests
        .filter(
          (r) => (r.pickupStatus || "").toUpperCase() === "COMPLETED"
        )
        .map((r) => ({
          ...r,
          myRating: r.myRating ?? myRatings[r.id] ?? null,
        })),
    [myRequests, myRatings]
  );

  const unreadNotifCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);
  

  const addNotification = useCallback((message) => {
    setNotifications((prev) => [
      ...prev,
      { id: `n-${Date.now()}-${Math.random()}`, message, time: Date.now(), read: false },
    ]);
  }, []);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  };

  // ---------- Navigation ----------
 const goToSection = (
  id,
  target = null
) => {

  setMainSection(
    VALID_SECTIONS.includes(id)
      ? id
      : "products"
  );

  setNotificationTarget(target);

  setSubView(null);

  setSidebarOpen(false);
};

  const handleNavTabClick = (tab) => {

  if (tab.id === "home") {
    navigate("/");
    return;
  }

  if (tab.id === "profile") {
    navigate("/profile");
    return;
  }

  goToSection(tab.id);

  
};

  const goToSidebarItem = (id) => goToSection(id);

  const recordBrowsing = useCallback((product) => {
    if (!product || product.sellerName === "You") return;
    setBrowsingHistory((prev) => {
      const next = [
        ...prev.filter((entry) => entry.id !== product.id),
        { id: product.id, category: product.category, type: product.type, time: Date.now() },
      ];
      return next.slice(-50);
    });
  }, []);

  const openDetail = useCallback(
    (product) => {
      recordBrowsing(product);
      setSelectedProduct(product);
      setReturnSection(mainSection);
      setSubView("detail");
    },
    [mainSection, recordBrowsing]
  );

  const closeDetail = () => {
    setSubView(null);
    setSelectedProduct(null);
    setMainSection(returnSection);
  };

  const openSellerProfile = (product) => {
    setViewedSeller({
      id: product.ownerId,
      name: product.sellerName,
      department: product.department,
      avatarUrl: product.sellerProfileImage,
      trustScore: product.sellerTrustScore,
    });
    setSubView("sellerProfile");
  };

  const closeSellerProfile = () => {
    setSubView("detail");
  };

  const goToProfile = () => navigate("/profile");

  // ---------- Step 1: buyer sends a request ----------

  // Sell / Donate: the "Request" button on a product goes straight to
  // this branch. Exchange goes to the other branch below.
  const handleRequestClick = (product) => {
    if (product.type === "Exchange") {
      setExchangeTarget(product);
    } else {
      setRequestTarget(product);
    }
  };


  
const createOutgoingRequest = async (product, offeredProduct) => {
  try {
    // CONFIRMED against RequestServiceImpl.addRequest() — the backend
    // maps product type -> the only allowed request type:
    //   Sell product     -> "BUY"     ("Sell products can only receive BUY requests")
    //   Exchange product -> "EXCHANGE"
    //   Donate product   -> "DONATE"
    // It's a plain String on CreateRequestRequest (not an enum), and
    // defaults to "BUY" server-side when blank.
    let requestType = "BUY";

    if (product.type === "Exchange") {
      requestType = "EXCHANGE";
    } else if (product.type === "Donate") {
      requestType = "DONATE";
    }

    const savedRequest = await createRequest({
      productId: product.id,
      requestType,
      offeredProductId: offeredProduct?.productId || null,
    });

    const newRequest = {
      id: savedRequest.id,
      productId: savedRequest.productId,
      productName: savedRequest.productTitle,
      productImage: null,
      category: product.category,
      sellerName: savedRequest.sellerName,
      type:
        savedRequest.requestType === "EXCHANGE"
          ? "Exchange"
          : savedRequest.requestType === "DONATE"
          ? "Donate"
          : "Sell",
      price: product.price,
      message: "",
      offeredProduct: offeredProduct || null,
      status: savedRequest.status,
      pickupLocation: null,
      pickupDate: null,
      pickupTime: null,
      pickupStatus: null,
      rescheduleReason: null,
      time: savedRequest.createdAt
        ? new Date(savedRequest.createdAt).getTime()
        : Date.now(),
    };

    setMyRequests((prev) => [
      newRequest,
      ...prev,
    ]);

    setPurchaseHistory((prev) =>
      [
        ...prev,
        {
          id: product.id,
          category: product.category,
          type: product.type,
          time: Date.now(),
        },
      ].slice(-50)
    );

    const info =
      TYPE_INFO[product.type] ||
      TYPE_INFO.Sell;

    addNotification(
      `${info.actionLabel} sent to ${product.sellerName} for "${product.name}".`
    );

    showToast(
      `${info.actionLabel} sent successfully.`
    );

    if (subView === "detail") {
      closeDetail();
    }

  } catch (error) {

    showToast(
      extractErrorMessage(error, "Failed to send request.")
    );
  }
};

  // Sell / Donate confirm
const handleConfirmRequest = async () => {
  if (!requestTarget) return;

  await createOutgoingRequest(
    requestTarget,
    null
  );

  setRequestTarget(null);
};

  // Exchange: buyer picked an item from My Purchases to offer
 const handleConfirmExchangeItem = async (offeredPurchase) => {
  if (!exchangeTarget) return;

  await createOutgoingRequest(
    exchangeTarget,
    {
      id: offeredPurchase.id,
      productId: offeredPurchase.productId,
      productName: offeredPurchase.productName,
      productImage: offeredPurchase.productImage,
      category: offeredPurchase.category,
    }
  );

  setExchangeTarget(null);
};

  // ---------- Step 3: buyer reviews the proposed schedule ----------

  const handleConfirmSchedule = async (request) => {
    try {
      const pickup = await getPickupByRequestId(request.id);
      const pickupId = pickup.pickupId ?? pickup.id;

      await confirmSchedule(pickupId);

      await loadMyRequests();

      addNotification(
        `You confirmed the pickup schedule with ${request.sellerName}.`
      );
      showToast("Schedule confirmed.");
    } catch (error) {
      showToast(
        extractErrorMessage(error, "Failed to confirm the schedule. Please try again.")
      );
    }
  };

  const handleRequestReschedule = async (request, reason) => {
    try {
      const pickup = await getPickupByRequestId(request.id);
      const pickupId = pickup.pickupId ?? pickup.id;

      await requestReschedule(pickupId, reason);

      await loadMyRequests();

      showToast("Reschedule requested — waiting for the seller.");
    } catch (error) {
      showToast(
        extractErrorMessage(error, "Failed to request a reschedule. Please try again.")
      );
    }
  };

  // ---------- Step 5: buyer confirms receipt, or reports an issue ----------

  const handleConfirmReceived = async (request) => {
    try {
      const pickup = await getPickupByRequestId(request.id);
      const pickupId = pickup.pickupId ?? pickup.id;

      await confirmProductReceived(pickupId);

      // confirmProductReceived() on the backend also flips the
      // underlying Product's status (SOLD / EXCHANGED / DONATED) and
      // transfers ownership. For an EXCHANGE this affects the buyer's
      // OWN product too, so myProducts needs refreshing here
      // alongside myRequests.
      await loadMyRequests();
      await loadMyProducts();

      addNotification(
        `You confirmed pickup for "${request.productName}" with ${request.sellerName}.`
      );
      showToast("Pickup confirmed — check My Purchases.");
    } catch (error) {
      showToast(
        extractErrorMessage(error, "Failed to confirm pickup. Please try again.")
      );
    }
  };

  const handleReportDeliveryIssue = async (request, issueDetails) => {
    try {
      const pickup = await getPickupByRequestId(request.id);
      const pickupId = pickup.pickupId ?? pickup.id;

      await reportDeliveryIssue(pickupId, issueDetails);

      await loadMyRequests();

      showToast("Issue reported — a complaint has been filed against the seller.");
    } catch (error) {
      showToast(
        extractErrorMessage(error, "Failed to report the issue. Please try again.")
      );
    }
  };

  // ---------- Step 6: buyer rates the seller, from My Purchases,
  // after the pickup is COMPLETED ----------

  const handleRateSeller = async (purchase, { rating, comment }) => {
    try {
      const pickup = await getPickupByRequestId(purchase.id);
      const pickupId = pickup.pickupId ?? pickup.id;

      await rateSeller(pickupId, { rating, comment });

      setMyRatings((prev) => ({
        ...prev,
        [purchase.id]: rating,
      }));

      await loadMyRequests();

      showToast(`You rated ${purchase.sellerName} ${rating}/5.`);
    } catch (error) {
      showToast(
        extractErrorMessage(error, "Failed to submit rating. Please try again.")
      );
    }
  };

  // "Report a problem" on a purchase card sends the person into the
  // existing Raise Complaint flow with that transaction preselected,
  // instead of a separate modal — one complaint path for the whole app.
  const handleGoToComplaint = (purchase) => {
    setRaiseComplaintTarget(purchase);
    goToSection("raiseComplaint");
  };

const handleCancelMyRequest = async (request) => {

  try {

    await deleteRequest(request.id);

    setMyRequests((prev) =>
      prev.filter((r) => r.id !== request.id)
    );

    showToast("Request cancelled successfully.");

  } catch (error) {

    showToast(
      extractErrorMessage(error, "Failed to cancel request.")
    );
  }
};

  // ---------- Complaints ----------
  // Only completed transactions (confirmed pickups) are eligible —
  // enforced by only ever passing `myPurchases` into RaiseComplaintSection.
  const handleRaiseComplaint = (
  createdComplaint
) => {

  const complaint =
    mapBackendComplaint(
      createdComplaint
    );


  setComplaints((prev) => [
    complaint,
    ...prev,
  ]);


  addNotification(
    `Your complaint about "${complaint.productName}" has been submitted.`
  );


  showToast(
    "Complaint submitted successfully."
  );

  // Clear so returning to Raise Complaint later starts at the picker
  // again instead of re-jumping to the same transaction.
  setRaiseComplaintTarget(null);
};

  const handleProductSubmit = async (
    productData,
    imageFiles = [],
    primaryImageIndex = null,
    deletedImageIds = [],
    primaryImageId = null
  ) => {
    try {
      // ==========================================
      // EDIT PRODUCT
      // ==========================================
      if (editingProduct) {
        const productId = editingProduct.id;

        // 1. Update product details
        await updateProduct(productId, productData);

        // 2. Upload newly selected images FIRST, so the product never
        // dips to zero images while old ones are being deleted
        // (ProductService.deleteProductImage() refuses to leave a
        // product with no images). The backend also caps a product at
        // 4 images total.
        if (imageFiles.length > 0) {
          await uploadProductImages(productId, imageFiles, primaryImageIndex);
        }

        // 3. Delete removed old images
        for (const imageId of deletedImageIds) {
          await deleteProductImage(productId, imageId);
        }

        // 4. Set existing image as primary
        if (primaryImageId) {
          await setPrimaryImage(productId, primaryImageId);
        }

        // 5. Reload My Products
        const updatedProducts = await getMyProducts();

        setMyProducts((updatedProducts || []).map(mapBackendProduct));

        showToast("Product updated successfully.");
      } else {
        // ==========================================
        // ADD NEW PRODUCT
        // ==========================================

        const savedProduct = await addProduct(productData, imageFiles, primaryImageIndex);

        const mappedProduct = mapBackendProduct(savedProduct);

        setMyProducts((prev) => [mappedProduct, ...prev]);

        showToast("Product listed successfully.");

        addNotification(`Your listing "${mappedProduct.name}" has been submitted.`);
      }

      // ==========================================
      // CLOSE FORM
      // ==========================================

      setEditingProduct(null);
      setSubView(null);
      setMainSection("myProducts");
    } catch (error) {
      showToast(extractErrorMessage(error, "Failed to save product."));
    }
  };



  const handleConfirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }

    try {
      await deleteProduct(deleteTarget.id);

      setMyProducts((prev) => prev.filter((p) => p.id !== deleteTarget.id));

      showToast("Product deleted.");
      setDeleteTarget(null);

      if (subView === "detail") {
        closeDetail();
      }
    } catch (error) {
      showToast(extractErrorMessage(error, "Failed to delete product."));
    }
  };

  // ========================================
// MARK ONE NOTIFICATION AS READ
// ========================================

const handleMarkNotificationAsRead = async (notification) => {

  try {

    if (!notification.read) {

      await markNotificationAsRead(
        notification.id
      );

      setNotifications((prev) =>
        prev.map((item) =>
          item.id === notification.id
            ? {
                ...item,
                read: true,
              }
            : item
        )
      );

    }


    // ========================================
    // REFRESH REQUEST DATA
    // ========================================

    if (
      notification.notifyType === "REQUEST_ACCEPTED" ||
      notification.notifyType === "REQUEST_REJECTED" ||
      notification.notifyType === "PICKUP_SCHEDULED" ||
      notification.notifyType === "PICKUP_CONFIRMED" ||
      notification.notifyType === "RESCHEDULE_REQUESTED" ||
      notification.notifyType === "PICKUP_RESCHEDULED" ||
      notification.notifyType === "BUYER_CONFIRMATION_REQUIRED" ||
      notification.notifyType === "TRANSACTION_COMPLETED" ||
      notification.notifyType === "DELIVERY_ISSUE_REPORTED"
    ) {
      await loadMyRequests();
      await loadIncomingRequests();
    }

    // ========================================
    // REFRESH COMPLAINT DATA
    // ========================================

    if (
      notification.notifyType === "COMPLAINT_RECEIVED" ||
      notification.notifyType === "SELLER_WARNING"
    ) {
      await loadComplaintsAgainstMe();
    }

    if (
      notification.notifyType === "COMPLAINT_UPDATED" ||
      notification.notifyType === "COMPLAINT_RESOLVED"
    ) {
      await loadMyComplaints();
    }

    // ========================================
    // REFRESH PRODUCT DATA (admin block / unblock)
    // Keeps the fresh My Products list so the navigation below can
    // open the affected product with its up-to-date status.
    // ========================================

    let refreshedMyProducts = null;

    if (
      notification.notifyType === "PRODUCT_BLOCKED" ||
      notification.notifyType === "PRODUCT_UNBLOCKED"
    ) {
      refreshedMyProducts = await loadMyProducts();
      await loadBrowseProducts();
    }

    // ========================================
    // NOTIFICATION NAVIGATION
    // ========================================

    switch (notification.notifyType) {

      case "REQUEST_RECEIVED":
      case "PICKUP_CONFIRMED":
      case "RESCHEDULE_REQUESTED":

        goToSection(
          "incomingRequests",
          {
            type: notification.notifyType,
            relatedId: notification.relatedId,
          }
        );

        break;


      case "REQUEST_ACCEPTED":
      case "REQUEST_REJECTED":
      case "PICKUP_SCHEDULED":
      case "PICKUP_RESCHEDULED":
      case "BUYER_CONFIRMATION_REQUIRED":

        goToSection(
          "myRequests",
          {
            type: notification.notifyType,
            relatedId: notification.relatedId,
          }
        );

        break;


      case "REQUEST_CANCELLED":
      case "TRANSACTION_COMPLETED":
      case "DELIVERY_ISSUE_REPORTED":

        goToSection(
          "incomingRequests",
          {
            type: notification.notifyType,
            relatedId: notification.relatedId,
          }
        );

        break;


      case "COMPLAINT_RECEIVED":
      case "SELLER_WARNING":

        goToSection(
          "complaintsAgainstMe",
          {
            type: notification.notifyType,
            relatedId: notification.relatedId,
          }
        );

        break;


      case "COMPLAINT_UPDATED":
      case "COMPLAINT_RESOLVED":

        goToSection(
          "myComplaints",
          {
            type: notification.notifyType,
            relatedId: notification.relatedId,
          }
        );

        break;


      // Opens the blocked / unblocked product's detail page. If the
      // product can't be found (e.g. deleted since), the seller just
      // lands on My Products instead.
      case "PRODUCT_BLOCKED":
      case "PRODUCT_UNBLOCKED": {

        goToSection("myProducts");

        const target = (refreshedMyProducts || []).find(
          (p) => String(p.id) === String(notification.relatedId)
        );

        if (target) {
          setSelectedProduct(target);
          setReturnSection("myProducts"); // Back returns to My Products
          setSubView("detail");
        }

        break;
      }


      default:

        break;
    }

  } catch (error) {

    console.error(
      "Failed to process notification:",
      error
    );

    showToast(
      "Failed to open notification."
    );

  }

};


// ========================================
// MARK ALL NOTIFICATIONS AS READ
// ========================================

const handleMarkAllNotificationsAsRead = async () => {
  try {
    await markAllNotificationsAsRead();

    setNotifications((prev) =>
      prev.map((notification) => ({
        ...notification,
        read: true,
      }))
    );

  } catch (error) {
    console.error(
      "Failed to mark all notifications as read:",
      error
    );
  }
};

  const renderMain = () => {
    if (subView === "detail" && selectedProduct) {
      // Prefer the latest copy from myProducts so the status
      // (AVAILABLE / BLOCKED) is always fresh.
      const liveProduct =
        myProducts.find(
          (p) => String(p.id) === String(selectedProduct.id)
        ) || selectedProduct;

      const isOwner = myProducts.some(
        (p) => String(p.id) === String(selectedProduct.id)
      );

      const blocked = isOwner && isProductBlocked(liveProduct);

      return (
        <ProductDetailSection
          product={liveProduct}
          isOwner={isOwner}
          isBlocked={blocked}
          onBack={closeDetail}
          onRequest={handleRequestClick}
          onEdit={(p) => {
            if (isProductBlocked(p)) return;
            setEditingProduct(p);
            setSubView("edit");
          }}
          onDelete={(p) => {
            if (isProductBlocked(p)) return;
            setDeleteTarget(p);
          }}
          onViewSeller={openSellerProfile}
        />
      );
    }

    if (subView === "add") {
      return (
        <ProductFormPage
          studentId={studentProfile?.studentId}
          onCancel={() => {
            setSubView(null);
            setMainSection("myProducts");
          }}
          onSubmit={handleProductSubmit}
        />
      );
    }

    if (subView === "edit" && editingProduct) {
      return (
        <ProductFormPage
          initialData={editingProduct}
          studentId={studentProfile?.studentId}
          onCancel={() => {
            setSubView(null);
            setEditingProduct(null);
          }}
          onSubmit={handleProductSubmit}
        />
      );
    }

    if (subView === "sellerProfile" && viewedSeller) {
      return (
        <SellerProfileSection
          seller={viewedSeller}
          products={sellerProducts}
          onBack={closeSellerProfile}
          onOpenProduct={openDetail}
        />
      );
    }

    switch (mainSection) {
      case "products":
        return (
          <BrowseProductsSection
            products={marketplaceProducts}
            onOpen={openDetail}
            recommendations={recommendations}
          />
        );
  case "incomingRequests":
  return (
    <IncomingRequestsSection
      onToast={showToast}

      notificationTargetId={
        notificationTarget?.relatedId
      }

      onRequestUpdated={async () => {

        await loadIncomingRequests();

        await loadMyRequests();

        await loadMyProducts();

        await loadBrowseProducts();

      }}
    />
  );
     case "notifications":
  return (
    <NotificationsSection
      notifications={notifications}
      onMarkAsRead={handleMarkNotificationAsRead}
    />
  );
      case "myProducts":
        return (
          <MyProductsSection
            products={myProducts}
            onOpen={openDetail}
            onAdd={() => setSubView("add")}
            onEdit={(p) => {
              if (isProductBlocked(p)) return;
              setEditingProduct(p);
              setSubView("edit");
            }}
            onDelete={(p) => {
              if (isProductBlocked(p)) return;
              setDeleteTarget(p);
            }}
          />
        );
     case "myRequests":
  return (
    <MyRequestsSection
      requests={myRequests}
      onCancel={handleCancelMyRequest}
      onConfirmSchedule={handleConfirmSchedule}
      onRequestReschedule={handleRequestReschedule}
      onConfirmReceived={handleConfirmReceived}
      onReportDeliveryIssue={handleReportDeliveryIssue}
      notificationTargetId={
        notificationTarget?.relatedId
      }
    />
  );
      case "myPurchases":
        return (
          <MyPurchasesSection
            purchases={myPurchases}
            onRateSeller={handleRateSeller}
            onGoToComplaint={handleGoToComplaint}
          />
        );
     case "myComplaints":
  return (
    <MyComplaintsSection
      complaints={complaints}
      notificationTargetId={notificationTarget?.relatedId}
    />
  );
  case "raiseComplaint":
        // Keyed on the target id (falling back to a stable string for
        // the plain picker view) so it remounts each time a new
        // purchase is targeted via "Report a problem".
        return (
          <RaiseComplaintSection
            key={raiseComplaintTarget?.id ?? "picker"}
            completedTransactions={myPurchases}
            onSubmit={handleRaiseComplaint}
            preselected={raiseComplaintTarget}
          />
        );
      case "complaintsAgainstMe":
  return (
    <ComplaintsAgainstMeSection
      complaints={complaintsAgainstMe}
      notificationTargetId={notificationTarget?.relatedId}
    />
  );
   default:
        // mainSection should always be one of VALID_SECTIONS (enforced at
        // every entry point above), so this should be unreachable. But if
        // it's ever hit anyway, fall back to Browse Products instead of
        // returning null.
        return (
          <BrowseProductsSection
            products={marketplaceProducts}
            onOpen={openDetail}
            recommendations={recommendations}
          />
        );
    }
  };

  const topNavActiveId =
    subView === null && STUDENT_NAV_TABS.some((t) => t.id === mainSection) ? mainSection : null;
  const isSidebarItemActive = (id) => subView === null && mainSection === id;

  const avatarUrl = studentProfile?.profileImage
    ? `${PROFILE_IMAGE_BASE_URL}${studentProfile.profileImage}`
    : null;
  const studentName = studentProfile?.fullName || "Student";

  return (
    <div className="dash-page">
      <StudentNavbar
        activeId={topNavActiveId}
        onTabClick={handleNavTabClick}
        onSidebarToggle={() => setSidebarOpen((o) => !o)}
        sidebarOpen={sidebarOpen}
        unreadNotifCount={unreadNotifCount}
        incomingPendingCount={0}
      />

      <div className="dash-body">
        {sidebarOpen && <div className="dash-sidebar-backdrop" onClick={() => setSidebarOpen(false)}></div>}

        <aside className={`dash-sidebar ${sidebarOpen ? "dash-sidebar-open" : "dash-sidebar-closed"}`}>
          <button className="dash-sidebar-profile" onClick={goToProfile} title="View profile">
            <span className="dash-sidebar-avatar">
              {avatarUrl ? <img src={avatarUrl} alt="" /> : <FaUser />}
            </span>
            <span className="dash-sidebar-username">{studentName}</span>
          </button>

          <div className="dash-sidebar-divider"></div>

          <nav className="dash-sidebar-nav">
            {SIDEBAR_ITEMS.map((item) => (
              <button
                key={item.id}
                className={`dash-sidebar-link ${isSidebarItemActive(item.id) ? "active" : ""}`}
                onClick={() => goToSidebarItem(item.id)}
                title={item.label}
              >
                <span>{item.label}</span>
              </button>
            ))}

            <div className="dash-sidebar-group-label">{COMPLAINTS_SIDEBAR_GROUP.label}</div>
            {COMPLAINTS_SIDEBAR_GROUP.items.map((item) => (
              <button
                key={item.id}
                className={`dash-sidebar-link dash-sidebar-link-nested ${
                  isSidebarItemActive(item.id) ? "active" : ""
                }`}
                onClick={() => goToSidebarItem(item.id)}
                title={item.label}
              >
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="dash-content">{renderMain()}</main>
      </div>

      {requestTarget && (
        <ConfirmDialog
          title={`${TYPE_INFO[requestTarget.type].actionLabel}?`}
          message={`Send a request to ${requestTarget.sellerName} for "${requestTarget.name}"?`}
          confirmLabel="Send Request"
          onCancel={() => setRequestTarget(null)}
          onConfirm={handleConfirmRequest}
        />
      )}

      {exchangeTarget && (
        <SelectExchangeItemModal
          product={exchangeTarget}
          purchases={myPurchases}
          onCancel={() => setExchangeTarget(null)}
          onConfirm={handleConfirmExchangeItem}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete this product?"
          message={`"${deleteTarget.name}" will be removed from your listings. This can't be undone.`}
          confirmLabel="Delete"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleConfirmDelete}
        />
      )}

      {toast && (
        <div className="dash-toast">
          <FaCheckCircle />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}

export default StudentDashboard;