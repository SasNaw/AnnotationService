<?php 
	$json = $_POST['json'];
	$source = $_POST['source'];
	
	/* sanity check */
	if (json_decode($json) != null)
	{
 		$file = fopen($source, 'w+');
		fwrite($file, $json);
		fclose($file);
	}
	else
	{
		// user has posted invalid JSON, handle the error 
   }
?>
