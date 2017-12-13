$(function(){
	var imglist = $(".pjnr img");
	// console.log(imglist);
	$(".pjnr").on("click","img",function(){
		$(".swiper-container").css("visibility","visible");
		for(var i =0; i<imglist.length; i++){
			$(".pjnr img:eq("+i+")").attr("src");
			// console.log($(".pjnr img:eq("+i+")").attr("src"));
			console.log($(".pjnr img:eq("+i+")").attr("src"));
			//功能未完成
		}
	});
	$(".swiper-container").click(function(){
		$(".swiper-container").css("visibility","hidden");
	})

	var mySwiper = new Swiper ('.swiper-container', {
	  direction: 'horizontal',
	  loop: false,
	  
	  // 如果需要分页器
	  pagination: {
	    el: '.swiper-pagination',
	  }
	})
})