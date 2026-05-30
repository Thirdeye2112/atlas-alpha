import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stockRouter from "./stock";
import scannerRouter from "./scanner";
import watchlistRouter from "./watchlist";
import marketRouter from "./market";
import backtestRouter from "./backtest";
import cacheRouter from "./cache";

const router: IRouter = Router();

router.use(healthRouter);
router.use(stockRouter);
router.use(scannerRouter);
router.use(watchlistRouter);
router.use(marketRouter);
router.use(backtestRouter);
router.use(cacheRouter);

export default router;
