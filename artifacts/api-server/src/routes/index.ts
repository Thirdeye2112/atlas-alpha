import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stockRouter from "./stock";
import scannerRouter from "./scanner";
import watchlistRouter from "./watchlist";
import marketRouter from "./market";

const router: IRouter = Router();

router.use(healthRouter);
router.use(stockRouter);
router.use(scannerRouter);
router.use(watchlistRouter);
router.use(marketRouter);

export default router;
